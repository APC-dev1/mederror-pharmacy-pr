@echo off
title Mederror Pharmacy System
cd /d "%~dp0"
echo ================================================================
echo    Pharmacy Daily Dispensing and Mederror Tracking System
echo ================================================================
echo.
echo Starting system... Please wait.
echo Your web browser will open automatically at http://localhost:3000
echo.
node server.js
pause
