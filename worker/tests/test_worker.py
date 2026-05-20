from fastapi.testclient import TestClient

from app.main import app


def test_health() -> None:
    client = TestClient(app)
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json()['status'] == 'ok'


def test_estimate() -> None:
    client = TestClient(app)
    response = client.post('/estimate', json={'text': 'a' * 7000, 'max_chunk_chars': 3500})
    assert response.status_code == 200
    data = response.json()
    assert data['chunks'] == 2
    assert data['estimated_tokens'] > 0
