/**
 * Application HUD. All DOM updates flow through this class; the rest of the
 * renderer never touches document nodes directly.
 */
export interface HudBindings {
  onQualityChange: (presetId: string) => void;
  onLoseContext: () => void;
  onRestoreContext: () => void;
  onRunSelfTests: () => void;
}

interface KeyValue {
  label: string;
  value: string;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly contextBadge: HTMLElement;
  private readonly contextDetail: HTMLElement;
  private readonly sizeDetail: HTMLElement;
  private readonly qualityDetail: HTMLElement;
  private readonly testList: HTMLElement;
  private readonly errorBox: HTMLElement;

  constructor(bindings: HudBindings) {
    const root = document.getElementById('hud');
    if (root === null) {
      throw new Error('HUD root element #hud not found');
    }
    this.root = root;
    root.innerHTML = '';

    const title = document.createElement('h1');
    title.textContent = '体积云渲染器 · 基础工程层';
    root.appendChild(title);

    root.appendChild(this.section('GL 上下文'));
    this.contextBadge = document.createElement('span');
    this.contextBadge.className = 'badge restoring';
    this.contextBadge.textContent = '初始化中';
    const badgeRow = document.createElement('div');
    badgeRow.className = 'row';
    badgeRow.appendChild(this.contextBadge);
    root.appendChild(badgeRow);

    this.contextDetail = document.createElement('div');
    root.appendChild(this.contextDetail);

    root.appendChild(this.section('画布 / 缓冲'));
    this.sizeDetail = document.createElement('div');
    root.appendChild(this.sizeDetail);

    root.appendChild(this.section('画质档位'));
    const qualityRow = document.createElement('div');
    qualityRow.className = 'row';
    const select = document.createElement('select');
    select.id = 'quality-select';
    select.addEventListener('change', () => {
      bindings.onQualityChange(select.value);
    });
    qualityRow.appendChild(select);
    this.qualityDetail = document.createElement('div');
    root.appendChild(qualityRow);
    root.appendChild(this.qualityDetail);
    this.qualitySelect = select;

    root.appendChild(this.section('控制'));
    const controls = document.createElement('div');
    const loseBtn = document.createElement('button');
    loseBtn.textContent = '模拟上下文丢失';
    loseBtn.addEventListener('click', () => bindings.onLoseContext());
    const restoreBtn = document.createElement('button');
    restoreBtn.textContent = '请求恢复';
    restoreBtn.addEventListener('click', () => bindings.onRestoreContext());
    const testBtn = document.createElement('button');
    testBtn.textContent = '运行自测';
    testBtn.addEventListener('click', () => bindings.onRunSelfTests());
    controls.append(loseBtn, restoreBtn, testBtn);
    root.appendChild(controls);

    root.appendChild(this.section('自测结果'));
    this.testList = document.createElement('ul');
    root.appendChild(this.testList);

    this.errorBox = document.createElement('div');
    this.errorBox.className = 'error-box';
    this.errorBox.hidden = true;
    root.appendChild(this.errorBox);
  }

  private readonly qualitySelect: HTMLSelectElement;

  private section(title: string): HTMLElement {
    const el = document.createElement('h2');
    el.textContent = title;
    return el;
  }

  setContextStatus(status: 'healthy' | 'lost' | 'restoring' | 'failed', detail: string): void {
    this.contextBadge.className = `badge ${status}`;
    const label: Record<typeof status, string> = {
      healthy: '正常',
      lost: '已丢失',
      restoring: '恢复中',
      failed: '不可用',
    };
    this.contextBadge.textContent = label[status];
    this.contextDetail.textContent = detail;
  }

  setSizeInfo(rows: KeyValue[]): void {
    this.sizeDetail.replaceChildren(...rows.map((r) => this.keyValueRow(r)));
  }

  setQualityOptions(options: KeyValue[], selectedId: string): void {
    this.qualitySelect.replaceChildren(
      ...options.map((o) => {
        const opt = document.createElement('option');
        opt.value = o.label;
        opt.textContent = o.value;
        if (o.label === selectedId) {
          opt.selected = true;
        }
        return opt;
      }),
    );
  }

  setQualityDetail(rows: KeyValue[]): void {
    this.qualityDetail.replaceChildren(...rows.map((r) => this.keyValueRow(r)));
  }

  setTestResults(results: ReadonlyArray<{ name: string; ok: boolean; detail: string }>): void {
    this.testList.replaceChildren(
      ...results.map((r) => {
        const li = document.createElement('li');
        li.className = r.ok ? 'ok' : 'fail';
        li.textContent = `${r.name} — ${r.ok ? 'PASS' : 'FAIL'}${r.detail ? `：${r.detail}` : ''}`;
        return li;
      }),
    );
    // Also expose results to headless automation without DOM scraping.
    const json = document.getElementById('test-results');
    if (json !== null) {
      json.textContent = JSON.stringify(results);
    }
  }

  showError(message: string): void {
    this.errorBox.hidden = false;
    this.errorBox.textContent = message;
  }

  clearError(): void {
    this.errorBox.hidden = true;
    this.errorBox.textContent = '';
  }

  private keyValueRow(row: KeyValue): HTMLElement {
    const el = document.createElement('div');
    el.className = 'row';
    const label = document.createElement('span');
    label.textContent = row.label;
    const value = document.createElement('span');
    value.textContent = row.value;
    el.append(label, value);
    return el;
  }
}
