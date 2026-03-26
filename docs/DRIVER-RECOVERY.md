# NVIDIA Driver Recovery

## Problem

The NVIDIA 590 driver packages were removed from Ubuntu repos when NVIDIA replaced the 590 branch with 595. The prebuilt kernel module (`linux-modules-nvidia-590-open-6.17.0-19-generic`) is no longer available for the current kernel (6.17.0-19). However, the prebuilt module for kernel 6.17.0-14 is still cached locally in `/var/cache/apt/archives/`.

Kernel modules only work with the exact kernel version they were built for, so you must boot into 6.17.0-14 to use the cached prebuilt module.

## Recovery steps

### 1. Boot into kernel 6.17.0-14-generic

Reboot and hold **Shift** during boot to open the GRUB menu. Select **Advanced options for Ubuntu**, then select **6.17.0-14-generic**.

### 2. Install dependencies and cached driver packages

```bash
# Required dependency (may have been removed by apt autoremove)
sudo apt install ocl-icd-libopencl1

# Install the cached 590 driver packages
sudo dpkg -i \
  /var/cache/apt/archives/nvidia-firmware-590-590.48.01_590.48.01-0ubuntu0.24.04.1_amd64.deb \
  /var/cache/apt/archives/nvidia-kernel-common-590_590.48.01-0ubuntu0.24.04.1_amd64.deb \
  /var/cache/apt/archives/nvidia-kernel-source-590-open_590.48.01-0ubuntu0.24.04.1_amd64.deb \
  /var/cache/apt/archives/libnvidia-common-590_590.48.01-0ubuntu0.24.04.1_amd64.deb \
  /var/cache/apt/archives/libnvidia-compute-590_590.48.01-0ubuntu0.24.04.1_amd64.deb \
  /var/cache/apt/archives/libnvidia-cfg1-590_590.48.01-0ubuntu0.24.04.1_amd64.deb \
  /var/cache/apt/archives/nvidia-compute-utils-590_590.48.01-0ubuntu0.24.04.1_amd64.deb \
  /var/cache/apt/archives/nvidia-utils-590_590.48.01-0ubuntu0.24.04.1_amd64.deb \
  /var/cache/apt/archives/nvidia-headless-no-dkms-590-open_590.48.01-0ubuntu0.24.04.1_amd64.deb \
  /var/cache/apt/archives/linux-modules-nvidia-590-open-6.17.0-14-generic_6.17.0-14.14~24.04.1+1_amd64.deb
```

These are prebuilt packages -- no DKMS compilation, no GPU interaction during install.

### 3. Load the kernel module

```bash
sudo modprobe nvidia
```

Ensure it loads automatically on future boots:

```bash
echo "nvidia" | sudo tee /etc/modules-load.d/nvidia.conf
```

### 4. Verify

```bash
nvidia-smi
```

Should show driver 590 and CUDA Version 13.1.

### 5. Downgrade CUDA toolkit to 13.1

The CUDA toolkit (13.2) is newer than the driver supports (13.1). This mismatch causes a hard system freeze when building GPU code. Downgrade the toolkit:

```bash
wget https://developer.download.nvidia.com/compute/cuda/13.1.0/local_installers/cuda_13.1.0_590.44.01_linux.run
sudo sh cuda_13.1.0_590.44.01_linux.run --toolkit --silent --override
sudo ln -sfn /usr/local/cuda-13.1 /usr/local/cuda
```

### 6. Verify toolkit version

```bash
nvcc --version   # should show CUDA 13.1
```

### 7. Run setup.sh

```bash
./setup.sh
```

Should pass all prerequisite checks and build llama.cpp without freezing.

## Important notes

- **Do NOT run `sudo apt autoremove`** without checking — it may remove nvidia dependencies like `ocl-icd-libopencl1`.
- **Do NOT upgrade the kernel** without first verifying that prebuilt nvidia module packages exist for the new kernel version.
- **Do NOT upgrade the nvidia driver via apt** — the DKMS kernel module build will freeze the system on kernel 6.17.
- **Do NOT clear the apt cache** (`apt clean`) — the cached `.deb` files in `/var/cache/apt/archives/` are the only source for these packages since they were removed from the repos.
