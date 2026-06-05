"""Unit tests for the SharePoint company-project sync helpers.

Pure logic — no database, no network, no SharePoint. Validates the project-key
slug, the summary/transcript/details classifier, the VTT transcript cleaner, and
(if markitdown is installed) the MarkItDown text fallback. Run from backend/:

    python -m tests.test_project_sync
"""

from app.services.sharepoint_project_sync import (
    _project_slug, _classify_doc_type,
)
from app.services.sharepoint_policy_sync import _extract_vtt, _extract_via_markitdown


def _run(name, fn):
    fn()
    print(f"  ok  {name}")


# ── _project_slug ─────────────────────────────────────────────────────────────
def test_project_slug_strips_non_alnum():
    assert _project_slug("Acme Corp - Retail!") == "AcmeCorpRetail"
    assert _project_slug("data_migration 2024") == "datamigration2024"


def test_project_slug_empty_falls_back():
    assert _project_slug("") == "project"
    assert _project_slug("---") == "project"


# ── _classify_doc_type ────────────────────────────────────────────────────────
def test_classify_transcript_by_extension():
    # .vtt/.srt are always transcripts regardless of filename wording.
    assert _classify_doc_type("Q2 review.vtt") == "transcript"
    assert _classify_doc_type("captions.srt", "Falcon/captions.srt") == "transcript"


def test_classify_transcript_by_keyword():
    assert _classify_doc_type("Falcon demo recording.docx") == "transcript"
    assert _classify_doc_type("kickoff.docx", "Falcon/Transcripts/kickoff.docx") == "transcript"


def test_classify_summary():
    assert _classify_doc_type("Project Summary.docx") == "summary"
    assert _classify_doc_type("overview.pdf") == "summary"


def test_classify_defaults_to_details():
    assert _classify_doc_type("architecture.pdf") == "details"
    assert _classify_doc_type("scope and deliverables.docx") == "details"


# ── _extract_vtt ──────────────────────────────────────────────────────────────
def test_extract_vtt_strips_headers_timestamps_and_dedupes():
    vtt = (
        "WEBVTT\n"
        "\n"
        "1\n"
        "00:00:00.000 --> 00:00:02.000\n"
        "<v Alice>Welcome to the demo.\n"
        "\n"
        "2\n"
        "00:00:02.000 --> 00:00:04.000\n"
        "Welcome to the demo.\n"          # duplicate rolling caption → collapsed
        "\n"
        "3\n"
        "00:00:04.000 --> 00:00:06.000\n"
        "Let's begin.\n"
    ).encode("utf-8")
    out = _extract_vtt(vtt)
    assert "WEBVTT" not in out
    assert "-->" not in out
    assert "<v" not in out
    assert out == "Welcome to the demo.\nLet's begin.", repr(out)


def test_extract_vtt_empty():
    assert _extract_vtt(b"") == ""


# ── MarkItDown fallback (skipped if markitdown not installed) ──────────────────
def test_markitdown_converts_plaintext():
    try:
        import markitdown  # noqa: F401
    except Exception:
        print("  skip test_markitdown_converts_plaintext (markitdown not installed)")
        return
    out = _extract_via_markitdown(b"Project Falcon\nDelivered a retail analytics dashboard.", "txt")
    assert "Falcon" in out, repr(out)


def main():
    print("test_project_sync:")
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            _run(name, fn)
    print("ALL PASSED")


if __name__ == "__main__":
    main()
