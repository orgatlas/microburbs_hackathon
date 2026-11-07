"""Turns facts + a quiz profile into the match object in docs/API_CONTRACT.md.

TODO(Carl): see the scoring rules in backend/SPEC.md. Keep this module free of
HTTP calls so it can be unit tested with plain dictionaries.
"""


def score(facts, profile):
    raise NotImplementedError
