from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional, List
from pydantic import ConfigDict

class GenerateTextRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    prompt: str = Field(..., max_length=4000)
    size: str = Field("auto", max_length=20)
    quality: Optional[str] = Field(None, max_length=10)
    model_id: str = Field("gpt-image-2", max_length=64)
    task_id: Optional[str] = Field(None, max_length=50)
    client_request_id: Optional[str] = Field(None, max_length=64)
    share_to_square: bool = False

class GenerateTextImageRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    prompt: str = Field(..., max_length=4000)
    image_urls: List[str] = Field(..., max_length=5)
    size: str = Field("auto", max_length=20)
    quality: Optional[str] = Field(None, max_length=10)
    model_id: str = Field("gpt-image-2", max_length=64)
    task_id: Optional[str] = Field(None, max_length=50)
    client_request_id: Optional[str] = Field(None, max_length=64)
    share_to_square: bool = False
    local_image_urls: Optional[List[str]] = None

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
    params: Optional[dict] = None
    prompt: Optional[str] = None
    type: Optional[str] = None
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None

class UploadResponse(BaseModel):
    url: str
    is_duplicate: bool = False
    storage_name: Optional[str] = None

class PromptItem(BaseModel):
    id: str
    name: str
    prompt: str
    negative_prompt: Optional[str] = None
    tags: Optional[List[str]] = None
    created_at: str
    user_id: Optional[int] = None
    category: Optional[str] = None
    image_path: Optional[str] = None

class PromptCreateRequest(BaseModel):
    name: str = Field(..., max_length=200)
    prompt: str = Field(..., max_length=4000)
    negative_prompt: Optional[str] = Field(None, max_length=4000)
    tags: Optional[List[str]] = None
    category: Optional[str] = None
    image_path: Optional[str] = Field(None, max_length=1000)

class PromptUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    prompt: Optional[str] = Field(None, max_length=4000)
    negative_prompt: Optional[str] = Field(None, max_length=4000)
    tags: Optional[List[str]] = None
    category: Optional[str] = None
    image_path: Optional[str] = Field(None, max_length=1000)

class BatchDeleteRequest(BaseModel):
    ids: List[str] = Field(..., max_length=100)

class CategoryItem(BaseModel):
    id: int
    slug: str
    label: str
    count: int = 0

class CategoryCreateRequest(BaseModel):
    slug: str = Field(..., max_length=50)
    label: str = Field(..., max_length=100)

class CategoryUpdateRequest(BaseModel):
    label: str = Field(..., max_length=100)
