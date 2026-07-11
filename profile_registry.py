"""
profile_registry.py — Profile discovery and caching for the HA add-on.

Manages profile discovery via the remote registry endpoint, caching results
to avoid hammering the registry on every request.
"""

import logging
import time
from threading import Lock

log = logging.getLogger("profile_registry")

# Cache profiles for 30 seconds to avoid repeated registry calls
CACHE_TTL = 30


class ProfileRegistry:
    """Thread-safe cache for profile discovery results."""

    def __init__(self, proxy):
        self._proxy = proxy
        self._cache = None
        self._cache_time = 0
        self._lock = Lock()

    def get_profiles(self, force_refresh=False):
        """
        Return cached profiles or refresh from registry.
        Thread-safe — concurrent calls share the same refresh.
        """
        with self._lock:
            now = time.time()
            if (self._cache is None or force_refresh or
                    (now - self._cache_time) > CACHE_TTL):
                try:
                    self._cache = self._proxy.discover_profiles()
                    self._cache_time = now
                    log.debug("Profile cache refreshed: %d profiles", len(self._cache))
                except Exception as e:
                    log.warning("Profile discovery failed: %s", e)
                    if self._cache is None:
                        self._cache = []
        return self._cache

    def get_port(self, profile_name):
        """Look up a profile's port. Returns None if not found."""
        profiles = self.get_profiles()
        for p in profiles:
            if p.get("name") == profile_name:
                return p.get("port")
        return None

    def get_profile(self, profile_name):
        """Return a single profile dict by name, or None."""
        profiles = self.get_profiles()
        for p in profiles:
            if p.get("name") == profile_name:
                return p
        return None