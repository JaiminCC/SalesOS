@echo off
cd /d %~dp0
if not exist .env (
  echo Copy .env.example to .env and replace the placeholder secrets first.
  exit /b 1
)
call pnpm install
if errorlevel 1 exit /b 1
call pnpm infra:up
if errorlevel 1 exit /b 1
call pnpm db:setup
if errorlevel 1 exit /b 1
call pnpm --filter "./packages/*" build
if errorlevel 1 exit /b 1
start "salesos-api" cmd /c pnpm dev:api
start "salesos-worker" cmd /c pnpm dev:worker
call pnpm dev:web
