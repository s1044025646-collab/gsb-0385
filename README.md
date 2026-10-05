# Booth 基二有符号乘法回放后端

使用 TypeScript + Node.js + SQLite(`node:sqlite`,无原生依赖)实现的基二 Booth 有符号整数乘法教学服务。只做 API 与 CLI,不生成机器码、不访问 CPU 寄存器、不实现更高基数变体。

## 环境要求

- Windows 本地运行,无需 Docker / WSL / 外部服务
- Node.js >= 22.5(内置 `node:sqlite`;启动时的 ExperimentalWarning 可忽略)

## 快速开始

```powershell
npm install        # 安装开发依赖 (typescript 等)
npm run build      # 编译 TypeScript -> dist/
npm test           # 编译并运行全部测试 (含 n=2..5 穷举核对)
npm start          # 启动 API 服务,默认选择空闲端口
npm start -- --port=8080   # 指定端口
npm run demo       # 内置演示: -3*5, -8*-8, -8*-1 (n=4)
```

数据库文件保存在项目内 `data/booth.db`(可用环境变量 `BOOTH_DB` 覆盖),重启后仍可逐位查看历史算例。

## 算法说明

### 寄存器

- `A`:累加器,**n+1 位**(额外工作位,见下)
- `Q`:乘数寄存器,n 位
- `Q-1`:上一位,1 位,初始为 0
- 被乘数 M 同样符号扩展到 n+1 位工作位宽

### 每轮(共 n 轮)

1. 观察位对 `(Q0, Q-1)`:
   - `01` → `A = A + M`
   - `10` → `A = A - M`(在工作位宽内加 `-M` 的补码)
   - `00` / `11` → 不操作
2. 对组合寄存器 `{A, Q, Q-1}`(共 2n+2 位)做一次**算术右移**:最高符号位复制而不是补零;`A` 最低位进入 `Q` 最高位,`Q` 最低位进入 `Q-1`。

### 为什么需要 n+1 位工作寄存器

n 位补码的最小负数 `-2^(n-1)`(如 n=4 时的 `-8`)取负得到 `+2^(n-1)`,在 n 位内无法表示。当乘数位对为 `10` 且被乘数是最小负数时,`A - M` 需要计算 `+2^(n-1)`。A 与 M 使用 n+1 位后,该值可正确表示,最小负数输入不会被隐藏为"不支持"。

### 结果合成

n 轮后组合 `A`(n+1 位)与 `Q`(n 位)得到 2n+1 位带冗余符号位的结果。程序核对 A 的最高位(额外位)与次高位一致(确为符号扩展),再取低 2n 位作为完整补码乘积,并按 2n 位有符号数解码。

解释(每一步寄存器轨迹)由真实逐轮算法产生;宿主语言乘法只在测试中作为独立对照,不参与核心结果。全部位运算使用 BigInt 与显式掩码,不受 JavaScript 32 位位运算截断影响。

## CLI

```
node dist/cli.js run --n 4 --mode decimal --m -3 --q 5     # 创建并完整运行
node dist/cli.js run --n 4 --mode binary --m 1101 --q 0101 # 二进制补码模式(必须恰好 n 位)
node dist/cli.js list                                      # 列出算例
node dist/cli.js show <id>                                 # 查看完整过程
node dist/cli.js round <id> <r>                            # 查看某一轮
node dist/cli.js table <id> [--csv]                        # 导出寄存器表
node dist/cli.js verify <id> --mode decimal --product -15  # 核验候选结果
node dist/cli.js serve [--port 8080]                       # 启动 API
node dist/cli.js demo                                      # 内置演示
```

## HTTP API

统一错误格式:`{ "error": { "code", "message", "details" } }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/cases` | 创建并完整运行。Body: `{n, mode, multiplicand, multiplier}` |
| GET | `/api/cases` | 列出全部算例 |
| GET | `/api/cases/:id` | 查询算例与完整过程 |
| GET | `/api/cases/:id/rounds/:r` | 查询某一轮 |
| GET | `/api/cases/:id/table` | 寄存器表(`?format=csv` 导出 CSV) |
| POST | `/api/cases/:id/verify` | 核验候选乘积。Body: `{mode, product}` |

### 错误码

- `E_INVALID_WIDTH`:n 不是 2..32 的整数
- `E_MODE_REQUIRED`:mode 缺失或不是 `decimal`/`binary`
- `E_OPERAND_FORMAT`:操作数格式非法(如二进制串含非 0/1 字符,报告出错字符位置)
- `E_OPERAND_RANGE`:十进制操作数超出 n 位有符号范围
- `E_OPERAND_WIDTH`:二进制补码长度不等于 n(拒绝超宽静默截断)
- `E_NOT_FOUND`:算例或轮次不存在

### 示例

```powershell
# 创建算例 (-3 * 5, n=4)
curl -X POST http://127.0.0.1:8080/api/cases -H "Content-Type: application/json" `
  -d '{"n":4,"mode":"decimal","multiplicand":"-3","multiplier":"5"}'
# => product.bits = "11110001", product.value = "-15"

# 核验候选结果
curl -X POST http://127.0.0.1:8080/api/cases/1/verify -H "Content-Type: application/json" `
  -d '{"mode":"binary","product":"11110001"}'
# => {"ok":true,...}
```

## 持久化

SQLite 单库两张表:`cases`(原始输入、位宽、规范值、规则版本 `booth-radix2-v1`、乘积)与 `steps`(每轮操作前后寄存器快照)。算例与其全部步骤在同一事务中原子写入。修改位宽会创建新算例,不会重新解释旧二进制串。

## 测试

`npm test` 覆盖:

- n=2..5 全部输入组合与独立 BigInt 乘法穷举核对
- 零、最大正数、最小负数、全一、前导零、非法位宽
- 逐轮寄存器位宽、算术右移符号位复制、总轮数
- 交换操作数最终值相同
- 候选核验的位数/补码/数值检查与错误定位
- SQLite 持久化重开读取、HTTP API 端到端

## 限制

- 仅基二 Booth,每轮一次加减与一次算术右移,不实现更高基数变体
- n 限制为 2..32
- 仅模拟一次乘法,不生成机器码、不访问 CPU 寄存器
