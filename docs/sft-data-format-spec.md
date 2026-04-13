# IQuest-Coder SFT 数据格式交付约定（JSONL）V2

## 1. 数据格式的具体约束

### 1.1 数据组成

每一行是一个独立的 JSON 对象，代表一条完整对话样本。

### 1.2 顶层结构

```json
{
    "messages": [...], 
    "tools": [...]
}
```

- `messages`（必填）：有序消息列表
- `tools`（选填）：工具/函数定义，无工具时传 `[]` 或省略。训练时会通过 chat template 自动嵌入到 system 消息中，无需手动写入 system content

## 2. 各角色字段

### 2.1 system（可选，必须在首位，无内容则省略）

```json
{
    "role": "system", 
    "content": "你是一个翻译助手。"
}
```

### 2.2 user

```json
{
    "role": "user", 
    "content": "用户输入内容"
}
```

### 2.3 assistant

```json
{
    "role": "assistant",
    "reasoning_content": "思维链内容，无推理时填 null",
    "reasoning_content_mask": false,
    "content": "最终回复",
    "content_mask": false,
    "tool_calls": []
}
```

- `reasoning_content`：推理（Think 模式）下填字符串（可以是空字符串，不能是 null）；无推理（Instruct 模式）填 `null`（不要填空字符串）。
- `tool_calls`：不调用工具时可以省略
- **mask**（`reasoning_content_mask` 和 `content_mask`）为 `false` = 参与训练，`true` = 不参与训练

### 2.4 tool（紧跟含 `tool_calls` 的 assistant 之后，数量一一对应）

```json
{
    "role": "tool", 
    "content": "工具返回结果", 
    "content_mask": true
}
```

## 3. 消息顺序规则

```
[system] → user → assistant → [tool → ... → assistant]* → [user → assistant → ...]
```

- 对话必须以 `assistant` 结尾
- `tool` 后必须紧跟 `assistant`

## 4. 文件分割（严禁混存）

| 文件类型 | 判定条件 |
|---------|---------|
| 推理文件 | 任一 assistant 的 `reasoning_content` 非 null |
| 标准文件 | 所有 assistant 的 `reasoning_content` 均为 null |

## 5. 示例

### 5.1 标准对话

```json
{
    "messages": [
        {
            "role": "system", 
            "content": "你是一个翻译助手。"
        }, 
        {
            "role": "user", 
            "content": "把'Hello'翻译成中文。"
        }, 
        {
            "role": "assistant", 
            "reasoning_content": null, 
            "reasoning_content_mask": false, 
            "content": "你好。", 
            "content_mask": false
        }
    ], 
    "tools": []
}
```

### 5.2 含思维链

```json
{
    "messages": [
        {
            "role": "user", 
            "content": "若 X+2=5，X是几？"
        }, 
        {
            "role": "assistant", 
            "reasoning_content": "等式两边减2，X = 5 - 2 = 3。", 
            "reasoning_content_mask": false, 
            "content": "X等于3。", 
            "content_mask": false
        }
    ], 
    "tools": []
}
```

### 5.3 工具调用

```json
{
    "messages": [
        {
            "role": "user", 
            "content": "北京天气怎么样？"
        }, 
        {
            "role": "assistant", 
            "reasoning_content": "需要调用天气工具。", 
            "content": "", 
            "tool_calls": [
                {
                    "id": "call_001", 
                    "type": "function", 
                    "function": {
                        "name": "get_weather", 
                        "arguments": "{\"city\":\"北京\"}"
                    }
                }
            ], 
            "reasoning_content_mask": false, 
            "content_mask": false
        }, 
        {
            "role": "tool", 
            "content": "{\"temperature\":\"28°C\",\"condition\":\"晴\"}", 
            "content_mask": true
        }, 
        {
            "role": "assistant", 
            "reasoning_content": null, 
            "reasoning_content_mask": false, 
            "content": "北京今天晴，28°C。", 
            "content_mask": false
        }
    ], 
    "tools": [
        {
            "type": "function", 
            "function": {
                "name": "get_weather", 
                "description": "查询天气", 
                "parameters": {
                    "type": "object", 
                    "properties": {
                        "city": {"type": "string"}
                    }, 
                    "required": ["city"]
                }
            }
        }
    ]
}
```
