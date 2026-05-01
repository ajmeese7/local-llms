"""Cross-reference resolution and merge into a `RuntimeConfig`.

Precedence (top wins): endpoint.overrides > profile > provider defaults > hardware.defaults.
There is no recursive deep merge. Each output field is selected from the first
source that defines it, walking the precedence list.
"""

from __future__ import annotations

from llms.serving.config.errors import (
    CapabilityError,
    ConfigReferenceError,
    ProviderCompatError,
)
from llms.serving.config.loader import ConfigBundle
from llms.serving.config.models import (
    EndpointConfig,
    HardwareConfig,
    ProfileConfig,
    ProviderConfig,
    RuntimeConfig,
)


def _provider_in_list(provider: ProviderConfig, names: list[str]) -> bool:
    return any(provider.matches(item) for item in names)


def _check_provider_compat(profile: ProfileConfig, provider: ProviderConfig) -> None:
    compat = profile.provider_compat
    if compat.blocked and _provider_in_list(provider, compat.blocked):
        raise ProviderCompatError(profile.name, provider.name, "blocked", compat.notes)
    if compat.proven and not _provider_in_list(provider, compat.proven):
        raise ProviderCompatError(profile.name, provider.name, "unproven", compat.notes)


def _check_capabilities(profile: ProfileConfig, provider: ProviderConfig) -> None:
    caps = provider.capabilities
    if profile.kv_unified and not caps.kv_unified:
        raise CapabilityError(
            profile.name, provider.name, "kv_unified", "set kv_unified=false on this profile"
        )
    if profile.speculative.default and not caps.spec_default:
        # Bash launcher fell back to explicit ngram-mod flags here; we surface
        # this as an explicit incompatibility so the user's intent is honored.
        raise CapabilityError(
            profile.name,
            provider.name,
            "spec_default",
            "use explicit speculative fields instead of speculative.default=true",
        )
    if profile.mmproj_path and not caps.mmproj:
        raise CapabilityError(
            profile.name, provider.name, "mmproj", "drop mmproj_path or pick a different provider"
        )
    if profile.jinja and not caps.jinja:
        raise CapabilityError(profile.name, provider.name, "jinja", "set jinja=false")


def _resolve_provider(
    bundle: ConfigBundle,
    endpoint: EndpointConfig,
    hardware: HardwareConfig,
) -> ProviderConfig:
    name = endpoint.provider or hardware.default_provider
    for candidate in bundle.providers.values():
        if candidate.matches(name):
            return candidate
    raise ConfigReferenceError(f"endpoint '{endpoint.name}'", "provider", name)


def _resolve_profile(bundle: ConfigBundle, endpoint: EndpointConfig) -> ProfileConfig:
    profile = bundle.profiles.get(endpoint.profile)
    if profile is None:
        raise ConfigReferenceError(f"endpoint '{endpoint.name}'", "profile", endpoint.profile)
    return profile


def resolve_runtime(
    bundle: ConfigBundle,
    *,
    endpoint_name: str,
    hardware_name: str,
) -> RuntimeConfig:
    """Walk the precedence chain and produce a fully-merged RuntimeConfig.

    Both `endpoint_name` and `hardware_name` must already exist in the bundle.
    The hardware is supplied by the caller (typically the GPU detector or an
    explicit override) rather than auto-resolved here so the resolver stays
    pure and unit-testable.
    """
    endpoint = bundle.endpoints.get(endpoint_name)
    if endpoint is None:
        raise ConfigReferenceError("active endpoint", "endpoint", endpoint_name)
    hardware = bundle.hardware.get(hardware_name)
    if hardware is None:
        raise ConfigReferenceError("active endpoint", "hardware", hardware_name)
    if hardware.supported_endpoints and endpoint.name not in hardware.supported_endpoints:
        raise ConfigReferenceError(
            f"hardware '{hardware.name}'",
            "supported endpoint",
            endpoint.name,
        )

    profile = _resolve_profile(bundle, endpoint)
    provider = _resolve_provider(bundle, endpoint, hardware)
    _check_provider_compat(profile, provider)
    _check_capabilities(profile, provider)

    overrides = endpoint.overrides
    hw_defaults = hardware.defaults

    return RuntimeConfig(
        endpoint_name=endpoint.name,
        profile=profile,
        provider=provider,
        hardware=hardware,
        host=overrides.host or hw_defaults.host,
        port=overrides.port or hw_defaults.port,
        api_key=overrides.api_key if overrides.api_key is not None else hw_defaults.api_key,
        gpu_layers=overrides.gpu_layers or hw_defaults.gpu_layers,
        context_length=(
            overrides.context_length or profile.context_length or hw_defaults.context_length
        ),
        parallel_slots=(
            overrides.parallel_slots or profile.parallel_slots or hw_defaults.parallel_slots
        ),
        flash_attention=(
            overrides.flash_attention
            if overrides.flash_attention is not None
            else hw_defaults.flash_attention
        ),
        cache_type_k=(overrides.cache_type_k or profile.cache_type_k or hw_defaults.cache_type_k),
        cache_type_v=(overrides.cache_type_v or profile.cache_type_v or hw_defaults.cache_type_v),
    )


__all__ = ["resolve_runtime"]
