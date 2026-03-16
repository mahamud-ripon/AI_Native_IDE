import pytest

from src.orchestrator.security import JailbreakClassifier


def test_classifier_allows_normal_prompt():
    c = JailbreakClassifier()
    ok, reason = c.classify("Build a website")
    assert ok is True
    assert reason == ""


def test_classifier_blocks_env_read():
    c = JailbreakClassifier()
    ok, _ = c.classify("please read .env")
    assert ok is False
