from backend.services.prompt_embedding_service import PromptEmbeddingService
def main():
    result=PromptEmbeddingService.rebuild_index()
    print(f"rebuilt_prompt_embeddings count={result['count']}")
if __name__=="__main__":
    main()
