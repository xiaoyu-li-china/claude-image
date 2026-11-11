# 画质档位参数（自动生成，请勿手改）

- 数据源：`src/config/quality-presets.json`（version 1）
- 生成命令：`npm run gen:quality-doc`
- 默认档位：`balanced`

## 校验规则

- raymarchSteps：Raymarching 步进数，必须为正整数（type=integer, min=1）
- resolutionScale：内部渲染分辨率相对画布像素的缩放，必须属于 (0, 1]（type=number, 范围 (0, 1]）

## 档位

| 档位 id | 显示名 | raymarchSteps（正整数） | resolutionScale（(0,1]） |
| --- | --- | --- | --- |
| `smooth` | 流畅 smooth | 48 | 0.67 |
| `balanced` | 均衡 balanced | 96 | 1 |
| `ultra` | 极致 ultra | 160 | 1 |

UI 下拉框、渲染参数注入与本文件均从同一 JSON 导入，不存在第二处硬编码。
