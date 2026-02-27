# Notifications

> Reference for the saga notification system.

---

## Setup

### ntfy (recommended — push to phone)

1. Install the ntfy app on your phone ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy))
2. Subscribe to a topic of your choice (use something unique, e.g., `saga-lucas-2026`)
3. Add the topic to your project setup:

   In `.ai-epics/docs/project-setup.md` (or `.ai-sagas/docs/project-setup.md`):
   ```markdown
   - **Notification channel:** ntfy
   - **Notification topic:** saga-lucas-2026
   ```

That's it. No accounts, no API keys. The public ntfy.sh server is free for reasonable use.

### Self-hosted ntfy

If you prefer not to use the public server:

```bash
# Docker
docker run -d -p 8080:80 binwiederhier/ntfy serve

# Then configure:
# - **Notification server:** http://localhost:8080
# - **Notification topic:** saga-lucas-2026
```

### macOS Desktop Only (no setup needed)

If you don't configure ntfy, saga falls back to macOS desktop notifications via `osascript`. These work when you're at your Mac but don't push to your phone.

---

## How Notifications Are Sent

### ntfy

```bash
# Simple notification
curl -s -d "$MESSAGE" "ntfy.sh/$TOPIC" > /dev/null 2>&1

# With priority (for urgent notifications like HALT)
curl -s \
  -H "Priority: urgent" \
  -H "Tags: warning" \
  -d "$MESSAGE" \
  "ntfy.sh/$TOPIC" > /dev/null 2>&1

# With a title
curl -s \
  -H "Title: Saga: $SAGA_TITLE" \
  -d "$MESSAGE" \
  "ntfy.sh/$TOPIC" > /dev/null 2>&1
```

### macOS Desktop

```bash
osascript -e "display notification \"$MESSAGE\" with title \"$TITLE\""
```

### Helper Pattern

The saga skill uses this pattern to send notifications:

```bash
notify() {
  local message="$1"
  local title="${2:-Saga}"
  local priority="${3:-default}"

  # Try ntfy first (if configured)
  if [ -n "$NTFY_TOPIC" ]; then
    curl -s \
      -H "Title: $title" \
      -H "Priority: $priority" \
      -d "$message" \
      "${NTFY_SERVER:-ntfy.sh}/$NTFY_TOPIC" > /dev/null 2>&1
  fi

  # Always try desktop notification on macOS
  if command -v osascript &> /dev/null; then
    osascript -e "display notification \"$message\" with title \"$title\"" 2>/dev/null
  fi
}
```

---

## Notification Events

| Event | Priority | Message template |
|-------|----------|-----------------|
| Saga complete | default | "Saga complete: {title}. All {N} epics delivered." |
| Epic complete (advancing) | low | "Epic {N} complete. Advancing to Epic {N+1}." |
| REVIEW: drift detected (paused) | high | "Saga paused: PRD drift after Epic {N}. Review needed." |
| HALT: iteration limit | urgent | "Saga halted: Epic {N} failed {M} times. Human needed." |
| HALT: deadlock | urgent | "Saga halted: dependency deadlock. Human needed." |
| Saga aborted | default | "Saga aborted: {title}. Work preserved." |

---

## Graceful Degradation

Notifications never block the saga workflow. If a notification fails to send (network error, ntfy down, osascript unavailable), the saga logs the failure and continues. The terminal message is always printed regardless of notification success.

```
Priority: ntfy (push) → osascript (desktop) → terminal (print + block if human input needed)
```

If human input is actually needed (REVIEW pause, HALT), the saga blocks on terminal input regardless of whether the notification was delivered successfully.
