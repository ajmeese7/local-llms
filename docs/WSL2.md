# WSL2

Native Linux users can skip this guide.

## LAN Access with Mirrored Networking

By default, WSL2 runs behind NAT. The server is reachable from Windows, but not from other machines on your LAN. To fix that, enable mirrored networking.

Edit or create `%USERPROFILE%\.wslconfig` on Windows:

```ini
[wsl2]
networkingMode=mirrored
vmIdleTimeout=-1
```

Then restart WSL:

```powershell
wsl --shutdown
```

After restart, other machines on the LAN can connect to the Windows host IP on port `9999`.

You also need a Windows firewall rule:

```powershell
New-NetFirewallRule -DisplayName "llama-server" -Direction Inbound -Protocol TCP -LocalPort 9999 -Action Allow
```

## Auto-Shutdown Behavior

WSL2 may shut down automatically when Windows thinks the VM is idle. `vmIdleTimeout=-1` helps, but may not be enough on its own.

For a more reliable keep-alive, place this in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\wslstart.cmd`:

```cmd
@start /b wsl --exec dbus-launch true
```

That keeps a lightweight background process alive inside WSL.

## Auto-Start on Windows Login

### Option A: Scheduled Task

1. Open Task Scheduler.
2. Create a new task.
3. Set:
   - Trigger: At log on
   - Program: `wsl.exe`
   - Arguments: `-d Ubuntu`
4. Disable the “Start only if on AC power” condition.

Because the service is enabled, systemd will start it automatically when the distro boots.

### Option B: WSL boot command

Add this to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
command=systemctl start llama-server
```

## Related Guides

- [SETUP.md](SETUP.md)
- [USAGE.md](USAGE.md)
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
