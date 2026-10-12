import pytest

# Corpus generation/evaluation is intentionally deferred by the user's staged plan.
evaluate_corpus = pytest.importorskip("evaluate", reason="30-document extraction corpus deferred to the next implementation stage").evaluate_corpus
from generate_fixtures import generate


def test_thirty_synthetic_samples_report_unavailable_ocr_honestly(tmp_path, monkeypatch):
    generate(tmp_path)
    monkeypatch.setattr("extraction.shutil.which", lambda command: None)
    result = evaluate_corpus(tmp_path / "manifest.json")
    assert result["totalSamples"] == 30
    assert result["realSamples"] == 0
    assert result["byFormat"]["text"]["fieldAccuracy"] == 1
    assert result["byFormat"]["pdf"]["availableSamples"] == 9
    assert result["byFormat"]["pdf"]["unavailableSamples"] == 1
    assert result["byFormat"]["image"]["unavailableSamples"] == 10
    assert result["byFormat"]["image"]["fieldAccuracy"] is None
    assert result["allFormatsEvaluated"] is False
