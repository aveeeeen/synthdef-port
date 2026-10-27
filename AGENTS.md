# Project Rules & Guidelines

## Strudel Prebake Specifications
Strudel の prebake 読み込み環境において、文字列表現にテンプレートリテラル（` `）やダブルクォーテーション（`"`）が含まれるとパースエラーの原因となります。

- **プレベイクファイル（`strudel-out/strudel-prebake.js` 等）での文字列構文ルール**:
  - テンプレートリテラル（` `）は一切使用せず、シングルクォーテーション（`'`）と文字列結合演算子（`+`）を使用すること。
  - ダブルクォーテーション（`"`）は一切使用せず、シングルクォーテーション（`'`）を使用すること。
  - 文字列内でクォート表現が必要な場合（エラーメッセージ等）も、ダブルクォーテーションではなくエスケープされたシングルクォーテーション（`\'`）を使用すること。

## Coding Style & General Principles
- 2 spaces for indentation.
- Always use strict equality (`===`, `!==`) for comparison in JavaScript / TypeScript.
- Prefer clarity over cleverness. Keep changes minimal, safe, and reversible.
