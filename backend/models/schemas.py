from __future__ import annotations
from pydantic import BaseModel
from typing import Optional, List

class GenerateTextRequest(BaseModel):
    prompt: str
    size: str = "auto"
    task_id: Optional[str] = None

class GenerateTextImageRequest(BaseModel):
    prompt: str
    image_urls: List[str]
    size: str = "auto"
    task_id: Optional[str] = None

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
    name: str
    prompt: str
    negative_prompt: Optional[str] = None
    tags: Optional[List[str]] = None

class PromptUpdateRequest(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    tags: Optional[List[str]] = None

class BatchDeleteRequest(BaseModel):
    ids: List[str]
