#!/usr/bin/env python3
import os,sys,argparse,subprocess
from pathlib import Path
from dotenv import load_dotenv
PROJECT_ROOT=Path(__file__).resolve().parent.parent.parent
def _load_env():
    cands=[PROJECT_ROOT/".env",PROJECT_ROOT.parent/"app_v1"/".env"]
    for p in cands:
        if p.exists():
            load_dotenv(p,override=False)
            return str(p)
    load_dotenv(override=False)
    return ""
def _run(cmd:list[str]):
    p=subprocess.run(cmd,cwd=str(PROJECT_ROOT),env=os.environ.copy())
    if p.returncode!=0:sys.exit(p.returncode)
def main():
    ap=argparse.ArgumentParser(description="One-click EVO sync: import + audit")
    ap.add_argument("--full-rebuild",action="store_true")
    ap.add_argument("--dry-run",action="store_true")
    args=ap.parse_args()
    env_file=_load_env()
    if not os.getenv("DATABASE_URL"):
        print("Error: DATABASE_URL not found in environment or .env")
        sys.exit(1)
    mode="full-rebuild" if args.full_rebuild else "incremental"
    print(f"[evo-sync] env={env_file or 'process-env'} mode={mode} dry_run={args.dry_run}")
    cmd=["python","-m","backend.scripts.import_evo","--mode",mode]
    if args.dry_run:cmd.append("--dry-run")
    _run(cmd)
    _run(["python","-m","backend.scripts.audit_evo_prompts"])
if __name__=="__main__":
    main()
