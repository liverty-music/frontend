## Context

Onboarding の Artist Discovery ページ (`/onboarding/discover`) で、バブルをタップしてアーティストをフォローしてもカウンター (0/3) が更新されない。

DevTools で調査した結果:
- `localStorage['guest.followedArtists']` には正しくデータが保存されている (5件)
- `localClient.listFollowed()` を直接呼ぶと 5 件返る
- しかし `localClient.followedCount` getter は 0 を返す
- 原因: Aurelia 2 のリアクティビティシステムが getter をキャッシュしており、localStorage への書き込みは observation の外にあるためキャッシュが再評価されない

加えて UX 上の課題:
- ガイダンスオーバーレイ「Tap bubbles to follow artists」が 5 秒で消え、復帰しない
- 数字 (0/3) だけでは何をすべきか分からない
- バブルをタップしたときの達成フィードバックが弱い

## Goals / Non-Goals

**Goals:**
- `followedCount` が localStorage への書き込みと同期し、UI がリアルタイムに更新される
- ガイダンスがユーザーを段階的に導く (初回タップ前 → 進捗中 → 完了)
- タップ時のフィードバックで達成感を演出する

**Non-Goals:**
- バブル UI 自体の抜本的な変更 (カテゴリステップ分割など)
- サウンドやハプティクスの追加
- coach-mark コンポーネントの onboarding 統合 (将来の改善として残す)

## Decisions

### 1. `@observable` による followedCount の同期

**選択**: `LocalArtistClient.followedCount` を getter から `@observable` プロパティに変更し、`follow()` / `unfollow()` / `clearAll()` で明示的に値を更新する。

**代替案**:
- **EventAggregator パターン**: `follow` イベントを publish → subscribe で再計算。疎結合だが、onboarding でしか使わないカウンターのために過剰。
- **getter を廃止してメソッド `getFollowedCount()` に変更**: 呼び出し側で毎回呼ぶ必要があり、Aurelia のバインディングと相性が悪い。
- **`IObserverLocator` でカスタム observer を登録**: Aurelia の internal API に依存し過ぎる。

**理由**: `@observable` は Aurelia 2 の標準的なリアクティビティ機構で、setter が呼ばれると自動的にバインディングが再評価される。影響範囲が `LocalArtistClient` 内に閉じる。

### 2. 段階的ガイダンスメッセージ

**選択**: `artist-discovery-page` に段階的なメッセージ表示を追加する。

```
0/3: 「好きなアーティストを3組タップしよう！」(初期表示、消えない)
1/3: 「いいね！あと2組！」
2/3: 「あと1組！」
3/3: 「準備完了！」→ 完了ボタンをハイライト
```

ガイダンスオーバーレイの auto-dismiss (5秒タイマー) は削除し、ユーザーが最初のバブルをタップするまで表示し続ける。

### 3. プログレスバーの常時表示

**選択**: プログレスバーとカウンターを onboarding 時は常に表示し、完了ボタンが表示されるまでの進捗を視覚的にフィードバックする。現在のコードでは `if.bind="isOnboarding"` で既に制御されているが、カウンター値が更新されないため機能していなかった。Decision 1 の修正で自然に動作するようになる。

## Risks / Trade-offs

- **[Risk] `@observable` と既存の getter の競合**: Aurelia が既にプロトタイプ getter をラップしている可能性がある → `@observable` に変更する際、getter を完全に削除して plain property + 手動更新に置き換えることでクリアに解決。
- **[Risk] 初期化時の followedCount 不整合**: ページ表示時に localStorage に既にデータがある場合 → コンストラクタまたは初期化時に `this.followedCount = this.listFollowed().length` を実行して同期。
- **[Trade-off] ガイダンスメッセージの日本語ハードコード**: i18n 対応が今後必要になる → 現時点では日本語で実装し、i18n 対応は別変更で行う。
