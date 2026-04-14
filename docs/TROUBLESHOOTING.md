# Troubleshooting

## CUDA toolkit / driver version mismatch

If `setup.sh` reports the CUDA toolkit is newer than the driver supports, or if building `llama.cpp` causes a hard system freeze, the toolkit version is higher than the driver's supported CUDA version.

Check the versions:

```bash
nvidia-smi | grep "CUDA Version"
nvcc --version
```

The toolkit version must be less than or equal to the driver-supported CUDA version.

If not, downgrade the toolkit instead of trying to upgrade the driver:

```bash
wget https://developer.download.nvidia.com/compute/cuda/13.1.0/local_installers/cuda_13.1.0_590.44.01_linux.run
sudo sh cuda_13.1.0_590.44.01_linux.run --toolkit --silent --override
sudo ln -sfn /usr/local/cuda-13.1 /usr/local/cuda
```

Do not try to fix this with an `apt` driver upgrade. The DKMS build can hit the same freeze path.

## Recovering from a broken NVIDIA driver install

See [DRIVER-RECOVERY.md](DRIVER-RECOVERY.md) for the full recovery process.

## CUDA / GPU not found

If you see:

```text
ggml_cuda_init: no CUDA devices found
```

Check:

- NVIDIA drivers are installed on the Windows host, not inside WSL
- `nvidia-smi` works inside Linux
- `llama.cpp` was built with `-DGGML_CUDA=ON`

## Out of memory

If you see:

```text
CUDA error: out of memory
```

Try:

- Reducing `CONTEXT_LENGTH`
- Using a smaller quantization such as Q4 instead of Q8
- Using a smaller model
- Closing other GPU-heavy apps on the host

## Port already in use

If you see:

```text
bind: Address already in use
```

Find the conflict:

```bash
ss -tlnp | grep 8000
```

Then either stop the conflicting process or change `PORT` in the config.

## Service fails to start

Check:

```bash
systemctl status llama-server
journalctl -u llama-server --no-pager -n 50
```

Common causes:

- Model file path in `MODEL` is wrong
- `llama-server` was never built
- Shell syntax error in the config file

## Build fails

```bash
sudo apt install build-essential cmake
nvcc --version

cd ~/.local/share/llama.cpp
rm -rf build
cmake -B build -DGGML_CUDA=ON \
  -DCMAKE_CUDA_COMPILER="$(command -v nvcc)" \
  -DCMAKE_CUDA_HOST_COMPILER=gcc-12
cmake --build build --config Release -j4
```

If the failure looks driver-related, go back to the CUDA version check above before retrying.
