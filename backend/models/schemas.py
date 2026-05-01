from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional, List

class GenerateTextRequest(BaseModel):
    prompt: str = Field(..., max_length=2500)
    size: str = Field("auto", max_length=20)
    task_id: Optional[str] = Field(None, max_length=50)

class GenerateTextImageRequest(BaseModel):
    prompt: str = Field(..., max_length=2500)
    image_urls: List[str] = Field(..., max_length=5)
    size: str = Field("auto", max_length=20)
    task_id: Optional[str] = Field(None, max_length=50)

class GenerateResponse(BaseModel):
    task_id: str
    status: str
    message: str

class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: Optional[int] = None
    result_urls: Optional[List[str]] = None
    error: Optional[str] = None

class UploadResponse(BaseModel):
    url: str
    is_duplicate: bool = False

class PromptItem(BaseModel):
    id: str
    name: str
    prompt: str
    negative_prompt: Optional[str] = None
    tags: Optional[List[str]] = None
    created_at: str
    user_id: Optional[int] = None

class PromptCreateRequest(BaseModel):
    name: str = Field(..., max_length=200)
    prompt: str = Field(..., max_length=2500)
    negative_prompt: Optional[str] = Field(None, max_length=2500)
    tags: Optional[List[str]] = None

class PromptUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    prompt: Optional[str] = Field(None, max_length=2500)
    negative_prompt: Optional[str] = Field(None, max_length=2500)
    tags: Optional[List[str]] = None

class BatchDeleteRequest(BaseModel):
    ids: List[str] = Field(..., max_length=100)
