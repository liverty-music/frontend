## 1. Fix followedCount Reactivity

- [x] 1.1 Change `LocalArtistClient.followedCount` from getter to `@observable` property
- [x] 1.2 Initialize `followedCount` from `listFollowed().length` in constructor
- [x] 1.3 Update `followedCount` in `follow()`, `unfollow()`, and `clearAll()` methods
- [x] 1.4 Verify `ArtistDiscoveryPage.followedCount` getter correctly propagates the observable value

## 2. Improve Onboarding Guidance

- [x] 2.1 Remove the 5-second auto-dismiss timer from guidance overlay in `ArtistDiscoveryPage.attached()`
- [x] 2.2 Keep guidance visible until the user taps their first bubble (dismiss in `onArtistSelected`)
- [x] 2.3 Change initial guidance message to "好きなアーティストを3組タップしよう！"
- [x] 2.4 Add staged progress messages (1/3: "いいね！あと2組！", 2/3: "あと1組！", 3/3: "準備完了！")
- [x] 2.5 Update `artist-discovery-page.html` template to bind staged messages

## 3. Verify End-to-End

- [x] 3.1 Confirm orb pulse fires on each follow (followedCountChanged callback)
- [x] 3.2 Test fresh onboarding flow: guidance shows → tap 3 bubbles → counter increments → complete button appears
- [x] 3.3 Test page reload with existing localStorage data: counter reflects saved state on load
