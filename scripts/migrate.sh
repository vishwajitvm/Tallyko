#!/usr/bin/env bash
# Apply pending database migrations (they also run automatically when the backend starts)
exec "$(dirname "$0")/db.sh" migrate "$@"
