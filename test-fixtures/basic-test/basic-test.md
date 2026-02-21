# Markdown Test

# 1. 見出し

# 見出し1

## 見出し2

### 見出し3

#### 見出し4

##### 見出し5

###### 見出し6

# 2. テキスト装飾

- **太字**
- *斜体*
- ~~打ち消し~~
- `inline code`
- [リンク](http://localhost:8080)

# 3. 引用

> これは引用です。
>
> - 引用内リスト
>   - 2つ目
>     - 3つ目

# 4. リスト

- a
  - a-1
    - a-1-1
      - a-1-1-1
        - a-1-1-1-1

1. a
2. b
   1. b-1
   2. b-2
      - b-2-1
      - b-2-2
        1. b-2-2-1
        - b-2-2-2 


# 5. 表

| left  | right | center |
| :---- | ----: | :----: |
| 10    |    10 |   10   |
| 20000 | 20000 | 20000  |
| 30    |    30 |   30   |

# 6. コードブロック（通常）

```ts
function greet(name: string): string {
  return `Hello, ${name}`;
}
```

```csharp
public class HelloWorld {
  public static void Main(string[] args) {
    Console.WriteLine("Hello, World!");
  }
}
```

# 7. TeX

```tex
\frac{df}{dx} = \lim_{h \to 0} \frac{f(x+h) - f(x)}{h}
```

$E = mc^2$

$$F = ma$$

---

## 8. 画像

![sample image](https://dummyimage.com/600x120/eeeeee/333333&text=Markdown+Test)

## 9. 区切り線

a

---

b
