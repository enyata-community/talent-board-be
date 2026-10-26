# Shared Yarn launcher for terminal and IDE Git hooks.
run_yarn() {
  if command -v yarn >/dev/null 2>&1; then
    yarn "$@"
  elif command -v corepack >/dev/null 2>&1; then
    corepack yarn "$@"
  else
    echo "Yarn is unavailable. Install Corepack or add Yarn to your PATH." >&2
    return 127
  fi
}