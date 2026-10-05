# Booth 有符号乘法回放后端

基二（radix-2）Booth 有符号整数乘法的教学后端：TypeScript + Node.js + SQLite，仅提供 API 与 CLI，不生成机器码、不访问 CPU 寄存器、不依赖 Docker / WSL / 外部服务。

## 功能

- 输入相同位宽 `n`（2..32）的被乘数与乘数，按补码寄存器步骤得到 `2n` 位乘积。
- 维护累加器 `A`、乘数寄存器 `Q`、上一位 `Q-1`，每轮观察 `{Q0, Q-1}`：
  - `01`：`A += M`；`10`：`A -= M`；`00` / `11`：不操作；
  - 随后对组合寄存器 `{A, Q, Q-1}` 做一次**算术右移**（复制符号位，`A` 低位进 `Q` 高位，`Q` 低位进 `Q-1`），共 `n` 轮。
- 每轮记录：操作前寄存器、判定位对、所选操作、加减后的 `A`、移位后的全部寄存器，二进制定宽并附有符号十进制解释。
- 解释全部由真实逐轮算法产生；直接乘法仅用于测试对照，不参与核心结果。
- SQLite 持久化原始输入、位宽、规范值、规则版本与全部步骤，算例 + 步骤在单事务内原子写入；重启后可逐位回放，修改位宽会创建新算例而不重解释旧数据。

## 为什么 A 和被乘数工作寄存器需要 n+1 位

`n` 位补码的最小负数 `-2^(n-1)` 的相反数 `2^(n-1)` 在 `n` 位内无法表示。Booth 算法中 `A -= M` 等价于 `A += (-M)`，当 `M` 为最小负数时 `-M` 会溢出 `n` 位。把 `A` 与 `M` 的工作位宽扩为 `n+1` 位（输入先符号扩展）后，`-M` 始终可表示，加减在工作位宽内完成，无需任何特判。`Q` 仍为 `n` 位，`Q-1` 为 1 位。

完成后组合 `A(n+1)` 与 `Q(n)` 得到 `2n+1` 位带冗余符号位的结果；程序会核对最高额外位确实是次高位的符号扩展，再取低 `2n` 位作为完整补码乘积。

## 位运算约定

全部位运算使用 `BigInt` 与显式掩码（`maskOf` / `toSigned` / `toUnsigned`），避免 JavaScript 默认 32 位按位运算截断高位，因此 `n=32` 时结果依然正确。

## 构建 / 测试 / 启动 / 演示

```powershell
npm install        # 仅开发依赖 typescript / @types/node
npm run build      # 编译到 dist/
npm test           # 编译并运行 node:test 测试（含 n=2..5 全组合穷举对照）
npm run demo       # 演示 -3x5、-8x-8、-8x-1（4 位）
npm start          # 启动 API 服务（默认自动选择空闲端口）
node dist/cli.js serve --port 8080   # 指定端口
```

数据目录默认为项目内 `data/`（可用环境变量 `BOOTH_DATA_DIR` 覆盖），数据库文件为 `data/booth.db`。

## CLI

```
node dist/cli.js create --n 4 --mode decimal --m -3 --q 5
node dist/cli.js create --n 4 --mode binary --m 1101 --q 0101
node dist/cli.js list
node dist/cli.js show --id 1
node dist/cli.js step --id 1 --round 2
node dist/cli.js export --id 1
node dist/cli.js verify --id 1 --mode binary --candidate 11110001
node dist/cli.js demo
node dist/cli.js serve [--port 8080]
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/multiplications` | 创建并完整运行算例，原子落库。Body: `{bitWidth, mode, multiplicand, multiplier}` |
| GET | `/api/multiplications` | 列出全部算例 |
| GET | `/api/multiplications/:id` | 查询算例与全部步骤 |
| GET | `/api/multiplications/:id/steps/:round` | 查询某一轮 |
| GET | `/api/multiplications/:id/export` | 导出对齐的寄存器表（text/plain） |
| POST | `/api/multiplications/:id/verify` | 核验候选乘积。Body: `{mode, candidate}` |

### 输入规则

- `bitWidth`：整数，2..32，否则 `E_BIT_WIDTH`。
- `mode`：`decimal` 或 `binary`。
- 十进制模式：操作数必须落在 `[-2^(n-1), 2^(n-1)-1]`，否则 `E_OPERAND_RANGE`；非整数格式报 `E_OPERAND_FORMAT`。
- 二进制模式：必须**恰好** `n` 个 `0/1` 字符，按补码解释；超宽或不足直接报 `E_BINARY_FORMAT`，不静默截断；前导零合法。

### 候选核验

- 二进制候选必须恰好 `2n` 位（`E_CANDIDATE_WIDTH` / `E_CANDIDATE_FORMAT`）。
- 十进制候选必须在 `2n` 位有符号范围内。
- 不符时返回 `ok:false` 与 `firstDiffPosition`（自左起 1 基的首个不同位）。

### 错误码

`E_BIT_WIDTH`、`E_MODE`、`E_OPERAND_FORMAT`、`E_OPERAND_RANGE`、`E_BINARY_FORMAT`、`E_NOT_FOUND`、`E_ROUND_RANGE`、`E_CANDIDATE_WIDTH`、`E_CANDIDATE_FORMAT`、`E_CANDIDATE_MISMATCH`、`E_BAD_JSON`、`E_ROUTE`。错误响应形如 `{"error":{"code","message","details"}}`。

## 运行演示（4 位 -3 x 5 = -15）

```
第 1 轮  A=00000 Q=0101 Q-1=0  对=10  A-=M -> A=00011  移位后 A=00001 Q=1010 Q-1=1
第 2 轮  A=00001 Q=1010 Q-1=1  对=01  A+=M -> A=11110  移位后 A=11111 Q=0101 Q-1=0
第 3 轮  A=11111 Q=0101 Q-1=0  对=10  A-=M -> A=00010  移位后 A=00001 Q=0010 Q-1=1
第 4 轮  A=00001 Q=0010 Q-1=1  对=01  A+=M -> A=11110  移位后 A=11111 Q=0001 Q-1=0
组合 A++Q = 111110001（冗余符号位核对通过）
乘积 = 11110001 = -15
```

另两个演示：`-8 x -8 = 64`（`01000000`）与 `-8 x -1 = 8`（`00001000`），均走同一套步骤，最小负数取反由 `n+1` 工作位宽自然容纳。

## 测试覆盖

- 三个演示算例的精确轨迹与结果。
- `n=2..5` 全部输入组合与独立 `BigInt` 乘法穷举核对（位型与值）。
- 逐轮校验寄存器位宽、算术移位（符号位复制、`A`→`Q`→`Q-1` 传递顺序）与总轮数。
- 乘积解码值落在 `2n` 位有符号范围内；交换操作数最终值相同。
- 零、最大正数、最小负数、全一、前导零、非法位宽、超宽二进制、候选核验错误定位。
- 持久化重开库后逐位回放一致；修改位宽产生新算例。
- `n=32` 大位宽不丢高位。

## 限制

- 仅基二 Booth，不实现更高基数变体；只模拟一次乘法的寄存器变化。
- 服务绑定 `127.0.0.1`，无鉴权，仅供本地教学使用。
- 十进制 / 二进制数值在 JSON 中以字符串传输（避免大数精度问题）。
