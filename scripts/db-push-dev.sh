#!/bin/bash
# DEV_DATABASE_URL을 사용해서 스키마를 동기화하는 스크립트
# 사용법: bash scripts/db-push-dev.sh

echo "DEV 데이터베이스에 스키마 동기화 중..."
DATABASE_URL="$DEV_DATABASE_URL" npm run db:push
echo "완료!"
