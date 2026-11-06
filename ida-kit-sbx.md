# Dùng `sbx` tạo sandbox opencode có IDA (ida-kit)

Hướng dẫn tạo sandbox Docker Sandboxes (`sbx`) chạy opencode cùng mixin `ida-kit`,
cho phép agent dùng IDA Pro qua MCP server `ida-mcp` (headless, idalib).

Kiểm tra trên: `sbx v0.51.0`, macOS (Apple Silicon), kit `opencode` v3 (`docker.io/sbx/opencode`, opencode v2.0.29, linux/arm64).

Kit dùng định dạng **v3** (`schemaVersion: "3"`). Kit `opencode` hiện chỉ phát hành dạng v3, mà `sbx`
không cho trộn kit v3 với kit v1/v2 trong cùng một sandbox:

```
error: resolve kits: cannot mix v3 kits with v1/v2 kits in one sandbox; ...
```

Vì vậy `ida-kit` cũng phải là v3.

## 1. Thành phần

```
sbx-ida-kit/
├── AGENTS.md                     # rule khi làm việc trên kit (phía host)
└── ida-kit/                      # mixin kit, tự chứa (self-contained)
    ├── ida-kit.yaml              # descriptor v3 (tên file = tên thư mục kit)
    ├── ida-kit.dockerfile        # recipe: overlay files/home/ + ENV
    └── files/home/               # → $HOME của user trong sandbox (/home/agent)
        ├── .config/opencode/
        │   └── AGENTS.md         # global rule: áp cho MỌI session trong sandbox
        └── ida-kit/              # → /home/agent/ida-kit/
            ├── install-ida.sh    # script cài đặt
            ├── runme.js          # tạo license + patch ida/libida
            └── ida/
                └── ida-pro_95_x64linux.run   # installer cho linux/amd64
```

Thêm `ida-pro_95_armlinux.run` vào `ida/` nếu sandbox chạy `linux/arm64`
(Apple Silicon); script tự chọn theo `uname -m`.

Trong v3, `files/` không còn được đổ vào sandbox trực tiếp: `ida-kit.dockerfile` copy
`files/home/` vào `/home/agent` (chủ sở hữu uid 1000) và đóng gói thành một layer image.
Kit được build trong builder sandbox `sbx-kit-builder` (cache theo nội dung), nên khi sửa
hay thêm file vào `files/` thì lần `sbx create` / `sbx kit validate` tiếp theo tự build lại.
Installer `.run` nằm trong layer này nên image kit sẽ to tương ứng.

### AGENTS.md trong kit

`files/home/.config/opencode/AGENTS.md` → `/home/agent/.config/opencode/AGENTS.md`.
OpenCode V2 nạp file này **trước** mọi `AGENTS.md` của project, nên rule trong đó áp
cho mọi session trong sandbox, bất kể workspace nào. Đây là chỗ đặt các quy ước
chung: phạm vi được phép (lab/red team), cách dùng IDA, đường dẫn `$IDADIR`, v.v.

- Rule riêng cho một repo thì để `AGENTS.md` ở gốc repo đó (host bind-mount, không
  cần nằm trong kit).
- Rule riêng cho một thư mục con thì đặt `AGENTS.md` ngay trong thư mục đó; file gần
  workspace nhất được nạp sau cùng.
- Nếu image đặt `XDG_CONFIG_HOME` khác mặc định, OpenCode đọc
  `$XDG_CONFIG_HOME/opencode/AGENTS.md`; khi đó copy thêm file vào đường dẫn đó.
- `AGENTS.md` ở gốc `sbx-ida-kit/` là rule cho việc sửa kit trên host, không được đưa
  vào sandbox — hai file độc lập, sửa cái nào cũng không tự đồng bộ sang cái kia.

`ida-kit/ida-kit.yaml` (kind `mixin`) và `ida-kit/ida-kit.dockerfile` khai báo:

| Mục | Nằm ở | Nội dung |
|-----|-------|----------|
| `ENV` | `ida-kit.dockerfile` | `IDADIR=/opt/ida-pro`, `IDA_NEXUS_IDALIB_ONLY=1`, `OPENCODE_CONFIG_CONTENT` đăng ký MCP server `ida` (`uv tool run ida-mcp stdio`). ENV của mixin được merge vào image ghép (thay cho `environment.variables` của v2) |
| `network-policy@1` | `ida-kit.yaml` | `pypi.org`, `files.pythonhosted.org`, các mirror Ubuntu (cho `uv`, `hcli`, `apt`). v3 tách allowlist theo phase: danh sách này khai báo cho cả `install` (hook cài đặt) và `runtime` (`uv tool run ida-mcp`); phase nào vắng là không được truy cập gì |
| `lifecycle@1` `install` | `ida-kit.yaml` | (1) cài `nodejs` nếu image chưa có, chạy bằng root; (2) `bash /home/agent/ida-kit/install-ida.sh`, chạy bằng user `agent` (uid 1000) |

Môi trường của hook v3 mặc định **không** nhận biến nào ngoài baseline (`PATH`, `HOME`, ...),
nên mỗi hook phải liệt kê trong `env:` mọi biến mà nó và các tiến trình con đọc. Hiện tại:
`IDADIR`, `WORKSPACE_DIR`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`. Nếu sửa `install-ida.sh`
để đọc thêm biến nào thì phải thêm vào `env:` của hook đó.

`install-ida.sh` tìm installer và `runme.js` theo thứ tự: `~/ida/` (ưu tiên cao nhất,
dùng để ghi đè) → `<kit>/ida/` → `<kit>/` (nơi có `runme.js`) → `$WORKSPACE_DIR/ida/`.
Nếu không tìm thấy installer đúng kiến trúc, script in ra các đường dẫn đã tìm và
**thoát mã 3**, nên `sbx create` dừng lại và in nguyên phần output đó:

```
✗ bash /home/agent/ida-kit/install-ida.sh (kit=ida-kit, user=1000, exit 3)
── captured output ──
IDA not installed yet.
  this machine : aarch64 (needs an ida-pro_*_armlinux.run installer)
  missing      : ida-pro_<version>_armlinux.run
  looked in    : /home/agent/ida /home/agent/ida-kit/ida ...
──────────────────────
```

Đây là chủ ý: `sbx` **chỉ hiện output của install command khi command đó exit khác 0**.
Nếu script thoát 0 (hành vi cũ), message `IDA not installed yet.` bị nuốt mất và sandbox
vẫn được tạo mà không ai biết là thiếu IDA. IDA là yêu cầu bắt buộc — không có tùy chọn
tạo sandbox thiếu IDA.

Lưu ý kiến trúc: sandbox local trên Mac Apple Silicon là `linux/arm64`, nên cần
`ida-pro_*_armlinux.run`. Trên máy x86_64 thì dùng `ida-pro_*_x64linux.run`.

License không cần file sẵn: `runme.js` sinh `idapro.hexlic` rồi ghi vào cả
`/opt/ida-pro` và `~/.idapro`. Muốn dùng license riêng thì đặt `idapro.hexlic` vào
`~/ida/` và sửa lại bước chạy `runme.js` (hoặc bỏ qua bằng cách patch tay).

## 2. Kiểm tra kit

```bash
cd ~/working/opencode/mobile_audit
sbx kit validate ./ida-kit
sbx kit inspect  ./ida-kit
```

Kết quả mong đợi: `✓ ./ida-kit — built`, `valid (directory)`, và `inspect` hiện
`Schema: v3`, `Network: 5 allow`, `Commands: 2 install`. Validate một kit v3 dạng source
nghĩa là build nó, nên cần `sandboxd` đang chạy: `--offline` không dùng được với kit v3
(báo `no kit builder configured`).

Kiểm tra hành vi khi thiếu installer (không cần Docker):

```bash
bash tests/test-install-ida-missing-installer.sh
```

## 3. Tạo sandbox

Workspace được bind-mount vào sandbox ở **cùng đường dẫn như trên host**, và
`$WORKSPACE_DIR` trỏ tới đó. `runme.js` đã nằm trong kit; installer IDA phải có trong
`ida-kit/files/home/ida-kit/ida/` (hoặc `~/ida/`, hoặc `$WORKSPACE_DIR/ida/`). Thiếu
installer thì `sbx create` dừng và in lý do (xem mục 1).

### Cách A: tạo rồi attach (khuyên dùng)

```bash
cd ~/working/opencode/mobile_audit
sbx create --name opencode-ida opencode --kit ./ida-kit .
sbx run --name opencode-ida
```

### Cách B: tạo và mở opencode ngay

```bash
sbx run --name opencode-ida opencode --kit ./ida-kit .
```

Một số tùy chọn hay dùng khi tạo:

```bash
# Thêm thư mục chứa binary/APK cần phân tích (chỉ đọc)
sbx create --name opencode-ida opencode --kit ./ida-kit . ~/samples:ro

# Giới hạn tài nguyên (IDA phân tích binary lớn khá tốn RAM)
sbx create --name opencode-ida --cpus 4 -m 8g opencode --kit ./ida-kit .
```

### Thêm kit vào sandbox opencode có sẵn

```bash
sbx kit add opencode-audit ./ida-kit
```

Lệnh này tạo lại container với kit mới; dữ liệu workspace không bị ảnh hưởng.

## 4. Kiểm tra IDA trong sandbox

```bash
sbx exec opencode-ida bash -lc '
  echo "IDADIR=$IDADIR  WORKSPACE_DIR=$WORKSPACE_DIR"
  test -x "$IDADIR/idat" && echo "idat: OK"
  ls ~/.idapro/venv/bin/python3
  opencode debug config | grep -A3 "\"ida\""
'
```

Kết quả mong đợi: `idat: OK`, có venv tại `~/.idapro/venv`, và `opencode debug config`
có server `ida` trong mục `mcp.servers`. Lưu ý: trên opencode v2.0.29, `opencode mcp list`
báo `No MCP servers configured` ngay cả khi config đã có server `ida` (và `mcp-gateway`),
nên đừng dựa vào lệnh đó để kiểm tra.

### Cài lại / ghi đè installer

Installer và `runme.js` đã nằm trong kit (`/home/agent/ida-kit/`), nên thường chỉ cần
chạy lại script:

```bash
sbx exec -it opencode-ida bash /home/agent/ida-kit/install-ida.sh
```

Khi cần dùng bản installer khác (ví dụ kit chưa có đúng kiến trúc), copy vào `~/ida`
của sandbox — thư mục này được ưu tiên hơn bản trong kit:

```bash
sbx exec opencode-ida mkdir -p /home/agent/ida
sbx cp ./ida/ida-pro_95_armlinux.run opencode-ida:/home/agent/ida/
sbx exec -it opencode-ida bash /home/agent/ida-kit/install-ida.sh
```

## 5. Sử dụng

Mở opencode trong sandbox:

```bash
sbx run --name opencode-ida
```

MCP server `ida` khởi động theo yêu cầu, lần đầu `uv` sẽ tải gói `ida-mcp`. Ví dụ prompt:

```
Mở /Users/macbook/working/opencode/mobile_audit/target/libnative.so bằng IDA,
liệt kê các hàm JNI_OnLoad / Java_* và decompile JNI_OnLoad.
```

Nên đặt binary cần phân tích trong workspace (hoặc trong thư mục mount `:ro`) để agent
truy cập bằng đường dẫn host. Database `.i64` được ghi cạnh binary, nên khi file nằm
trong mount `:ro` thì cần copy nó vào workspace trước.

Mở shell để làm việc thủ công:

```bash
sbx exec -it opencode-ida bash
# trong sandbox:
$IDADIR/idat -A -B -o/tmp/test.i64 ./target/libnative.so   # phân tích headless
```

Chép file giữa host và sandbox:

```bash
sbx cp opencode-ida:/tmp/test.i64 ./out/
sbx cp ./bin/sample opencode-ida:/home/agent/
```

## 6. Quản lý vòng đời

```bash
sbx ls                    # liệt kê sandbox
sbx stop opencode-ida     # dừng (giữ nguyên trạng thái, IDA đã cài)
sbx run --name opencode-ida   # chạy lại và attach
sbx rm opencode-ida       # xóa (lần tạo sau sẽ cài lại IDA)
sbx tui                   # dashboard tương tác
```

Thoát phiên opencode không làm mất sandbox. Dùng `sbx stop` thay cho `rm` để khỏi phải
cài lại IDA.

## 7. Xử lý sự cố

| Triệu chứng | Nguyên nhân / cách xử lý |
|-------------|--------------------------|
| `sbx create` dừng với `✗ bash /home/agent/ida-kit/install-ida.sh (… exit 3)` | Thiếu installer đúng kiến trúc cho máy này (script cố tình exit 3 để `sbx` hiện output; exit 0 sẽ bị `sbx` nuốt mất). Đọc các dòng `this machine` / `missing` / `looked in`, và `wrong arch` nếu kit có installer của kiến trúc khác. Thêm file vào `files/home/ida-kit/ida/` rồi `sbx kit add`, hoặc copy vào `~/ida` của sandbox (mục 4) |
| Agent không thấy rule trong sandbox | Kiểm tra `ls ~/.config/opencode/AGENTS.md` bên trong sandbox. Nếu image đặt `XDG_CONFIG_HOME` khác mặc định thì file phải nằm trong `$XDG_CONFIG_HOME/opencode/` |
| `no match` khi chạy `runme.js` | Bản IDA khác với bản script nhắm tới (9.4 beta1 / 9.5); pattern patch không còn khớp. Cần cập nhật `SEARCH`/`REPLACE` |
| `node not found, but runme.js needs it` | Image không có node và bước cài node trong `ida-kit.yaml` thất bại. Cài lại bằng `sbx kit add` hoặc `apt-get install nodejs` |
| `idat rejected ...` khi smoke test | License không hợp lệ cho bản IDA này. Xoá `~/.idapro/idapro.hexlic` và `/opt/ida-pro/idapro.hexlic` rồi chạy lại script |
| `opencode debug config` không có `ida` | Sandbox được tạo không kèm `--kit ./ida-kit` nên thiếu `OPENCODE_CONFIG_CONTENT` (khai báo trong `ida-kit.dockerfile`). Dùng `sbx kit add` |
| `cannot mix v3 kits with v1/v2 kits in one sandbox` | Một kit trong lệnh vẫn là v1/v2 (ví dụ bản `spec.yaml` cũ). Dùng `ida-kit.yaml` v3; các kit khác dùng bản v3 đã phát hành `docker.io/sbx/<name>` |
| Hook cài đặt không thấy biến môi trường (ví dụ `$WORKSPACE_DIR` rỗng, `uv`/`apt` không qua được proxy) | v3 chặn biến môi trường của hook theo mặc định. Thêm tên biến vào `env:` của hook trong `ida-kit.yaml` |
| `ida-mcp` lỗi do lệch phiên bản Python | Venv không khớp Python mà IDA nhúng. Chạy lại `install-ida.sh` (script sẽ tạo lại `~/.idapro/venv`) |
| `uv`/`hcli` báo `EACCES` | File trong `~/.idapro`, `~/.cache/uv` hoặc `~/.local/share/uv` bị root sở hữu: `sbx exec -u root opencode-ida chown -R agent: /home/agent/.idapro /home/agent/.cache/uv /home/agent/.local/share/uv` |
| Tải gói bị chặn | Domain chưa có trong network allowlist. Xem `sbx policy ls opencode-ida`, rồi bổ sung vào `network-policy@1` trong `ida-kit.yaml`, đúng phase: `install` cho hook cài đặt, `runtime` cho agent và `ida-mcp` |
| Lỗi chung của `sbx` | `sbx diagnose`, hoặc chạy lại lệnh với `-D` |
