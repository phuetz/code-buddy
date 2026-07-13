"""Pure camera capture health state for the semantic vision sidecar."""


class CameraHealthState:
    """Debounce capture failures into one offline/online transition per outage."""

    def __init__(self, failure_threshold: int = 20):
        self.failure_threshold = max(1, failure_threshold)
        self.consecutive_failures = 0
        self.offline = False

    def update(self, capture_ok: bool) -> tuple[str, int] | None:
        if capture_ok:
            self.consecutive_failures = 0
            if self.offline:
                self.offline = False
                return ("online", 120)
            return None

        self.consecutive_failures += 1
        if not self.offline and self.consecutive_failures >= self.failure_threshold:
            self.offline = True
            return ("offline", 150)
        return None
