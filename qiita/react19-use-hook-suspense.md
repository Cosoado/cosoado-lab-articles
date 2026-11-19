---
title: "React 19 の use() フックで非同期データ取得が 1/3 になった話"
tags: ["React", "TypeScript", "Next.js", "AppRouter", "個人開発"]
published: true
qiita_id: "47e75fd62bdefa6b0a0c"
qiita_url: "https://qiita.com/Cosoado/items/47e75fd62bdefa6b0a0c"
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/react19-use-hook-suspense/

React 19 に上げた週末、`useState + useEffect` で書いてたデータ取得コードを全部 `use()` に書き直したら、コンポーネントのコード量が3分の1になった。あっさり動いて拍子抜けした。

## Before: useState + useEffect を毎回書いていた

React 18 以前、コンポーネントで非同期データを取るときはこういうパターンを繰り返していた。

```tsx
function UserProfile({ id }: { id: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchUser(id)
      .then(setUser)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner />;
  if (error) return <p>エラー: {error.message}</p>;
  return <div>{user?.name}</div>;
}
```

ステート 3 本、`useEffect` 1 本で 20 行超。

## After: use() に渡すだけ

React 19 の `use()` フックは Promise を受け取り、値が解決されるまでコンポーネントを suspend させる。loading/error の制御を `Suspense` と `ErrorBoundary` に渡せるので、コンポーネント本体が一気にシンプルになる。

```tsx
// 親: Promise を useMemo で作って渡す
function UserPage({ id }: { id: string }) {
  const userPromise = useMemo(() => fetchUser(id), [id]);

  return (
    <Suspense fallback={<Spinner />}>
      <ErrorBoundary fallback={<p>データを取得できませんでした</p>}>
        <UserProfile promise={userPromise} />
      </ErrorBoundary>
    </Suspense>
  );
}

// 子: use() で受け取るだけ
function UserProfile({ promise }: { promise: Promise<User> }) {
  const user = use(promise);
  return <div>{user.name}</div>;
}
```

`UserProfile` が実質 2 行になった。`id` が変わると `useMemo` が新しい Promise を作り、`Suspense` が再び fallback を出す。

### 条件分岐の中で呼べるのが他のフックと違う

React のフックは「条件分岐の中で呼ぶな」がルールだが、`use()` はその例外。

```tsx
function MaybeProfile({
  show,
  promise,
}: {
  show: boolean;
  promise: Promise<User>;
}) {
  if (!show) return <p>非表示</p>;
  const user = use(promise); // ← if の中でも呼べる
  return <div>{user.name}</div>;
}
```

フィーチャーフラグで一部ユーザーだけにデータを取りに行かせたいとき、これが地味に便利だった。

## やらかし: ErrorBoundary なしで動かしたら画面が白くなった

最初に試したとき、`Suspense` だけ入れて `ErrorBoundary` を省いた。

```tsx
// ❌ ErrorBoundary を忘れたパターン
<Suspense fallback={<Spinner />}>
  <UserProfile promise={userPromise} />
</Suspense>
```

API が 500 を返した瞬間、`use()` は例外を throw し、`Suspense` はそれをキャッチしない。コンポーネントツリーがクラッシュして画面が真っ白になった。「Suspense があるから大丈夫」という思い込みが丸ごと間違いだった。`Suspense` と `ErrorBoundary` はセットで使うのが必須だと身に染みた。

React は `ErrorBoundary` をビルトインで提供しない（いまでも謎）ので、[react-error-boundary](https://github.com/bvaughn/react-error-boundary) を使う。

```bash
npm install react-error-boundary
```

```tsx
import { ErrorBoundary } from "react-error-boundary";

<Suspense fallback={<Spinner />}>
  <ErrorBoundary fallbackRender={({ error }) => <p>{error.message}</p>}>
    <UserProfile promise={userPromise} />
  </ErrorBoundary>
</Suspense>
```

## まとめ

- loading・error 管理は `Suspense` と `ErrorBoundary` に任せ、コンポーネントはデータを使うことだけに集中できる
- 条件分岐の中で呼べるのが他のフックとの唯一の違い
- **`ErrorBoundary` なしで使うと reject 時にツリーがクラッシュする**

詳細は [React 19 公式リリースノート（GitHub）](https://github.com/facebook/react/releases/tag/v19.0.0) に。
