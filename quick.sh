#!/bin/bash
# ./quick.sh start    启动容器
# ./quick.sh stop     停止容器
# ./quick.sh restart  重启容器
# ./quick.sh logs     查看日志
# ./quick.sh status   查看状态
# ./quick.sh update   重新构建并启动

cd "$(dirname "$0")"

case "${1:-start}" in
  start)
    docker compose up -d
    echo "服务已启动"
    docker compose ps
    ;;
  stop)
    docker compose down
    echo "服务已停止"
    ;;
  restart)
    docker compose restart
    echo "服务已重启"
    docker compose ps
    ;;
  logs)
    docker compose logs -f --tail=50
    ;;
  status)
    docker compose ps
    ;;
  update)
    docker compose down
    docker compose build
    docker compose up -d
    echo "更新完成"
    docker compose ps
    ;;
  *)
    echo "用法: $0 {start|stop|restart|logs|status|update}"
    ;;
esac
