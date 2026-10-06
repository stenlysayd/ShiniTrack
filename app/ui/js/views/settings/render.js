import { getPref, setPref } from '../../state.js';
import { createSelectDialog } from '../../components/select-dialog.js';

/**
 * Declarative settings renderer
 * Loops over schema array to build DOM for:
 * 'header', 'switch', 'select', 'text', 'button', 'info'
 *
 * @param {HTMLElement} container
 * @param {Array<Object>} schema
 */
export function renderSettings(container, schema) {
  if (!container || !Array.isArray(schema)) return;

  schema.forEach(item => {
    if (!item || !item.type) return;

    switch (item.type) {
      case 'header': {
        const h = document.createElement('div');
        h.className = 'settings-header';
        h.textContent = item.title || '';
        container.appendChild(h);
        break;
      }

      case 'switch': {
        const currentVal = getPref(item.key, item.default ?? '0');
        const isChecked = currentVal === '1' || currentVal === 'true';

        const row = document.createElement('div');
        row.className = 'card click settings-row settings-switch-row';
        row.setAttribute('role', 'switch');
        row.setAttribute('aria-checked', String(isChecked));

        const textWrap = document.createElement('div');
        textWrap.className = 'settings-text-wrap';

        const titleEl = document.createElement('div');
        titleEl.className = 't';
        titleEl.textContent = item.title || '';
        textWrap.appendChild(titleEl);

        if (item.subtitle) {
          const subEl = document.createElement('div');
          subEl.className = 's';
          subEl.textContent = item.subtitle;
          textWrap.appendChild(subEl);
        }
        row.appendChild(textWrap);

        const toggle = document.createElement('div');
        toggle.className = 'settings-switch-track' + (isChecked ? ' active' : '');

        const knob = document.createElement('div');
        knob.className = 'settings-switch-thumb';
        toggle.appendChild(knob);
        row.appendChild(toggle);

        let checked = isChecked;
        row.addEventListener('click', async () => {
          checked = !checked;
          row.setAttribute('aria-checked', String(checked));
          if (checked) {
            toggle.classList.add('active');
          } else {
            toggle.classList.remove('active');
          }
          const valStr = checked ? '1' : '0';
          await setPref(item.key, valStr);
          if (typeof item.onChange === 'function') {
            item.onChange(valStr);
          }
        });

        container.appendChild(row);
        break;
      }

      case 'select': {
        const currentVal = getPref(item.key, item.default ?? '');
        const findLabel = (v) => {
          const found = (item.options || []).find(o => String(o.value) === String(v));
          return found ? found.label : v;
        };

        const row = document.createElement('div');
        row.className = 'card click settings-row settings-select-row';

        const textWrap = document.createElement('div');
        textWrap.className = 'settings-text-wrap';

        const titleEl = document.createElement('div');
        titleEl.className = 't';
        titleEl.textContent = item.title || '';
        textWrap.appendChild(titleEl);

        const subEl = document.createElement('div');
        subEl.className = 's';
        subEl.textContent = item.subtitle || findLabel(currentVal);
        textWrap.appendChild(subEl);
        row.appendChild(textWrap);

        if (window.Icons && window.Icons.chevronRight) {
          const arrowWrap = document.createElement('div');
          arrowWrap.className = 'svg-icon';
          arrowWrap.style.color = 'var(--text-muted)';
          arrowWrap.innerHTML = window.Icons.chevronRight();
          row.appendChild(arrowWrap);
        }

        row.addEventListener('click', () => {
          const activeVal = getPref(item.key, item.default ?? '');
          createSelectDialog({
            title: item.title || '',
            options: item.options || [],
            selectedValue: activeVal,
            onSelect: async (newVal) => {
              await setPref(item.key, String(newVal));
              subEl.textContent = item.subtitle || findLabel(newVal);
              if (typeof item.onChange === 'function') {
                item.onChange(newVal);
              }
            }
          });
        });

        container.appendChild(row);
        break;
      }

      case 'text': {
        const currentVal = getPref(item.key, item.default ?? '');

        const field = document.createElement('div');
        field.className = 'card settings-field-card';

        const labelWrap = document.createElement('div');
        labelWrap.className = 'settings-text-wrap';

        const titleEl = document.createElement('div');
        titleEl.className = 't';
        titleEl.textContent = item.title || '';
        labelWrap.appendChild(titleEl);

        if (item.subtitle) {
          const subEl = document.createElement('div');
          subEl.className = 's';
          subEl.textContent = item.subtitle;
          labelWrap.appendChild(subEl);
        }
        field.appendChild(labelWrap);

        const inputWrap = document.createElement('div');
        inputWrap.className = 'settings-input-wrap';

        const input = document.createElement('input');
        input.type = item.password ? 'password' : 'text';
        input.className = 'settings-input';
        if (item.placeholder) input.placeholder = item.placeholder;
        input.value = currentVal;

        input.addEventListener('change', async (e) => {
          await setPref(item.key, e.target.value);
          if (typeof item.onChange === 'function') {
            item.onChange(e.target.value);
          }
        });

        inputWrap.appendChild(input);
        field.appendChild(inputWrap);
        container.appendChild(field);
        break;
      }

      case 'button': {
        const row = document.createElement('div');
        row.className = 'card click settings-row settings-button-row';

        if (item.icon && window.Icons) {
          const iconWrap = document.createElement('div');
          iconWrap.className = 'svg-icon';
          iconWrap.style.marginRight = '12px';
          iconWrap.style.color = 'var(--text-muted)';
          iconWrap.innerHTML = item.icon;
          row.appendChild(iconWrap);
        }

        const textWrap = document.createElement('div');
        textWrap.className = 'settings-text-wrap';

        const titleEl = document.createElement('div');
        titleEl.className = 't';
        titleEl.textContent = item.title || '';
        textWrap.appendChild(titleEl);

        if (item.subtitle) {
          const subEl = document.createElement('div');
          subEl.className = 's';
          subEl.textContent = item.subtitle;
          textWrap.appendChild(subEl);
        }
        row.appendChild(textWrap);

        if (window.Icons && window.Icons.chevronRight) {
          const arrowWrap = document.createElement('div');
          arrowWrap.className = 'svg-icon';
          arrowWrap.style.color = 'var(--text-muted)';
          arrowWrap.innerHTML = window.Icons.chevronRight();
          row.appendChild(arrowWrap);
        }

        if (typeof item.onClick === 'function') {
          row.addEventListener('click', item.onClick);
        }

        container.appendChild(row);
        break;
      }

      case 'info': {
        const infoEl = document.createElement('div');
        infoEl.className = 'settings-info-card';

        const iconWrap = document.createElement('div');
        iconWrap.className = 'svg-icon';
        iconWrap.style.color = 'var(--cyan)';
        iconWrap.style.marginRight = '10px';
        iconWrap.style.marginTop = '2px';
        iconWrap.innerHTML = window.Icons && window.Icons.info ? window.Icons.info() : '';
        infoEl.appendChild(iconWrap);

        const textEl = document.createElement('div');
        textEl.className = 'settings-info-text';
        textEl.textContent = item.text || '';
        infoEl.appendChild(textEl);

        container.appendChild(infoEl);
        break;
      }

      default:
        console.warn('Unknown settings item type:', item.type);
        break;
    }
  });
}
