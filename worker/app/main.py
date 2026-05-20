from fastapi import FastAPI
from pydantic import BaseModel, Field


app = FastAPI(title="ultrawiki-worker", version="0.1.0")


class EstimateRequest(BaseModel):
    text: str = Field(min_length=1)
    max_chunk_chars: int = Field(default=3500, gt=0)


class EstimateResponse(BaseModel):
    chunks: int
    estimated_tokens: int


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "worker", "status": "ok"}


@app.post("/estimate", response_model=EstimateResponse)
def estimate(req: EstimateRequest) -> EstimateResponse:
    chunks = (len(req.text) + req.max_chunk_chars - 1) // req.max_chunk_chars
    estimated_tokens = max(1, len(req.text) // 3)
    return EstimateResponse(chunks=chunks, estimated_tokens=estimated_tokens)
