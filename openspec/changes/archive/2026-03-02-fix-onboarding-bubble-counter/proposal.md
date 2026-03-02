## Why

Onboarding の Artist Discovery ページで、バブルをタップしてもカウンター (0/3) が増えない。
原因は Aurelia 2 のリアクティビティシステムが `LocalArtistClient.followedCount` getter をキャッシュしており、localStorage への書き込みが observation の外にあるためキャッシュが再評価されないこと。
加えて、ガイダンスオーバーレイが 5 秒で自動消去された後は復帰しないため、ユーザーは何をすべきか分からず離脱しやすい。

## What Changes

- `LocalArtistClient` の `followedCount` getter を `@observable` プロパティに変更し、`follow()` / `unfollow()` 時に明示的に値を更新する
- ガイダンス表示を改善し、バブルタップの視覚フィードバックと段階的な進捗メッセージを追加する
- `coach-mark` コンポーネント (既存だが未使用) を onboarding ステップで活用する

## Capabilities

### New Capabilities
- `onboarding-guidance`: バブル選択のインタラクティブなガイダンスと段階的フィードバック

### Modified Capabilities
(なし — 既存の spec はまだない)

## Impact

- `src/services/local-artist-client.ts` — followedCount のリアクティビティ修正
- `src/routes/artist-discovery/artist-discovery-page.ts` — ガイダンス表示ロジック改善
- `src/routes/artist-discovery/artist-discovery-page.html` — ガイダンス UI 追加
- `src/components/dna-orb/dna-orb-canvas.ts` — フォロー済みカウント連動の確認
- `src/components/coach-mark/` — onboarding での活用
