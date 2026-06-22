#!/bin/bash
# 将 .ai/rules.md 同步到各 AI 编码工具的配置目录
# 用法: bash .ai/sync.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SOURCE="$SCRIPT_DIR/rules.md"

echo "同步 AI 编码规则..."

# Claude Code - CLAUDE.md
cp "$SOURCE" "$PROJECT_ROOT/CLAUDE.md"
echo "✓ CLAUDE.md"

# Cursor - .cursor/rules/
mkdir -p "$PROJECT_ROOT/.cursor/rules"
cp "$SOURCE" "$PROJECT_ROOT/.cursor/rules/project.md"
echo "✓ .cursor/rules/project.md"

# Trae - .trae/rules/
mkdir -p "$PROJECT_ROOT/.trae/rules"
cp "$SOURCE" "$PROJECT_ROOT/.trae/rules/project.md"
echo "✓ .trae/rules/project.md"

# CodeBuddy - .coderover/rules/
mkdir -p "$PROJECT_ROOT/.coderover/rules"
cp "$SOURCE" "$PROJECT_ROOT/.coderover/rules/project.md"
echo "✓ .coderover/rules/project.md"

echo "同步完成！"
