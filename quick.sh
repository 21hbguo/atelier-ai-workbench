#!/bin/bash
# ./quick.sh start                  启动全部服务（db + app + searxng；首次部署用这个）
# ./quick.sh stop                   停止全部服务
# ./quick.sh restart                重启全部服务
# ./quick.sh logs [服务名]          查看日志（默认全部；可指定 app / searxng / db）
# ./quick.sh status                 查看状态
# ./quick.sh update                 只更新 app（重建并重启 app，不动 searxng/db）
# ./quick.sh search start|stop|restart|logs|status   单独操作 searxng 联网搜索
# ./quick.sh app restart|logs|status                 单独操作 app

cd "$(dirname "$0")"

# 确保系统时区为北京时间
EXPECTED_TZ="Asia/Shanghai"
CURRENT_TZ=$(readlink /etc/localtime 2>/dev/null | grep -oP '[^/]+/[^/]+$' || timedatectl show -p Timezone --value 2>/dev/null || echo "")
if [ "$CURRENT_TZ" != "$EXPECTED_TZ" ]; then
    echo "检测到系统时区为 $CURRENT_TZ，正在切换为北京时间..."
    sudo timedatectl set-timezone $EXPECTED_TZ
    echo "时区已切换为 $EXPECTED_TZ"
fi

# 单独操作子服务：./quick.sh <服务> <动作>
service_case() {
  local svc="$1" act="${2:-status}"
  case "$act" in
    start)   docker compose up -d "$svc"; docker compose ps "$svc" ;;
    stop)    docker compose stop "$svc"; echo "$svc 已停止" ;;
    restart) docker compose restart "$svc"; docker compose ps "$svc" ;;
    logs)    docker compose logs -f --tail=50 "$svc" ;;
    status)  docker compose ps "$svc" ;;
    *) echo "用法: $0 $svc {start|stop|restart|logs|status}" ;;
  esac
}

case "${1:-start}" in
  start)
    docker compose up -d
    echo "全部服务已启动"
    docker compose ps
    ;;
  stop)
    docker compose down
    echo "全部服务已停止"
    ;;
  restart)
    docker compose restart
    echo "全部服务已重启"
    docker compose ps
    ;;
  logs)
    if [ -n "$2" ]; then docker compose logs -f --tail=50 "$2"
    else docker compose logs -f --tail=50; fi
    ;;
  status)
    docker compose ps
    ;;
  update)
    # 日常更新只重建 app，searxng/db 保持不动（快速、不中断搜索服务）
    docker compose build app
    docker compose up -d --force-recreate app
    echo "app 更新完成（searxng/db 未动）"
    docker compose ps
    ;;
  search)
    service_case searxng "${2:-status}"
    ;;
  app)
    service_case app "${2:-status}"
    ;;
  db)
    service_case db "${2:-status}"
    ;;
  *)
    echo "用法: $0 {start|stop|restart|logs|status|update|search|app|db}"
    echo "  start                  启动全部（首次部署）"
    echo "  update                 只更新 app"
    echo "  search start|stop|...  单独操作 searxng"
    echo "  app restart|logs|...   单独操作 app"
    echo "  db restart|logs|...    单独操作 db"
    ;;
esac
