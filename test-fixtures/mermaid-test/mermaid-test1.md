# Mermaid（ローカル描画）テスト

## 1.Flowchart

- flowchart

```mermaid
flowchart TD
  A[Start] --> B{Check}
  B -->|Yes| C[Done]
  B -->|No| D[Retry]
  D --> B
```

- graph

```mermaid
graph TD
  A[Start] --> B{Check}
  B -->|Yes| C[Done]
  B -->|No| D[Retry]
  D --> B
```

## 2.Sequence Diagram

```mermaid
sequenceDiagram
  participant Alice
  participant Bob
  Alice->>Bob: Hello Bob, how are you?
  Bob-->>Alice: I am good thanks!
```

## 3.Class Diagram

```mermaid
classDiagram

  namespace MyNamespace {
    class User {
      +String name
      +String email
      +login()
      +logout()
    }
    class Admin {
      +String name
      +String email
      +login()
      +logout()
      +manageUsers()
    }
  }

  User <|-- Admin
```

## 4.State Diagram

```mermaid
stateDiagram
  [*] --> State1
  State1 --> [*]
  State1 --> State2
  State2 --> State1
```

## 5.Entity Relationship(ER) Diagram 

```mermaid
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
```

## 6.User Journey

```mermaid
journey
  title ユーザージャーニー
  section 登録
    ユーザー: 5: 登録フォームに入力
    システム: 4: 入力内容を検証
    システム: 3: 登録完了メールを送信
  section ログイン
    ユーザー: 5: メールのリンクをクリック
    システム: 4: トークンを検証
    システム: 3: ダッシュボードにリダイレクト
```

## 7.Gantt

```mermaid
gantt
  title プロジェクトスケジュール
  dateFormat  YYYY-MM-DD
  section 開発
  設計       :a1, 2024-01-01, 10d
  実装       :after a1, 20d
  テスト       :after a1, 15d
```

## 8.Pie Chart

```mermaid
pie
  title ブラウザシェア
  "Chrome" : 60
  "Firefox" : 25
  "Edge" : 10
  "その他" : 5
```

## 9.Quadrant Chart

```mermaid
quadrantChart
    title Reach and engagement of campaigns
    x-axis Low Reach --> High Reach
    y-axis Low Engagement --> High Engagement
    quadrant-1 We should expand
    quadrant-2 Need to promote
    quadrant-3 Re-evaluate
    quadrant-4 May be improved
    Campaign A: [0.3, 0.6]
    Campaign B: [0.45, 0.23]
    Campaign C: [0.57, 0.69]
    Campaign D: [0.78, 0.34]
    Campaign E: [0.40, 0.34]
    Campaign F: [0.35, 0.78]
```

## 10.Requirement Diagram

```mermaid
    requirementDiagram

    requirement test_req {
    id: 1
    text: the test text.
    risk: high
    verifymethod: test
    }

    element test_entity {
    type: simulation
    }

    test_entity - satisfies -> test_req

```