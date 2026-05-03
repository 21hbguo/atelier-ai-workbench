from backend.database import get_db

def main():
    with get_db() as conn:
        bad_balance = conn.execute("SELECT u.id,u.username,u.points,COALESCE(SUM(t.amount),0) AS ledger_delta FROM users u LEFT JOIN point_transactions t ON t.user_id=u.id GROUP BY u.id,u.username,u.points HAVING u.points<>COALESCE(SUM(t.amount),0) ORDER BY u.id").fetchall()
        dup_keys = conn.execute("SELECT request_key,COUNT(*) AS cnt FROM point_transactions WHERE request_key IS NOT NULL AND request_key<>'' GROUP BY request_key HAVING COUNT(*)>1 ORDER BY cnt DESC,request_key").fetchall()
        orphans = conn.execute("SELECT t.id,t.user_id,t.amount,t.type,t.created_at FROM point_transactions t LEFT JOIN users u ON u.id=t.user_id WHERE u.id IS NULL ORDER BY t.id DESC LIMIT 200").fetchall()
    print("== points_reconcile ==")
    print(f"balance_mismatch={len(bad_balance)}")
    for r in bad_balance[:200]:
        print(f"user_id={r['id']} username={r['username']} user_points={r['points']} ledger_delta={r['ledger_delta']}")
    print(f"duplicate_request_key={len(dup_keys)}")
    for r in dup_keys[:200]:
        print(f"request_key={r['request_key']} cnt={r['cnt']}")
    print(f"orphan_transactions={len(orphans)}")
    for r in orphans[:200]:
        print(f"tx_id={r['id']} user_id={r['user_id']} amount={r['amount']} type={r['type']} at={r['created_at']}")

if __name__ == '__main__':
    main()
