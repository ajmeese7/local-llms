#!/usr/bin/env python3
"""Print elapsed seconds from start and end timestamps."""

from __future__ import annotations

import sys


def main() -> None:
    start_value = float(sys.argv[1])
    end_value = float(sys.argv[2])
    print(f"{end_value - start_value:.3f}")


if __name__ == "__main__":
    main()
