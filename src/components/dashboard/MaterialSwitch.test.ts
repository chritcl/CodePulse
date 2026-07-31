import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MaterialSwitch from './MaterialSwitch.vue';

describe('MaterialSwitch', () => {
  it('切换时通过 v-model 事件提交布尔值', async () => {
    const wrapper = mount(MaterialSwitch, {
      props: {
        modelValue: false,
        label: '音乐控制',
      },
    });

    await wrapper.get('input').setValue(true);

    expect(wrapper.emitted('update:modelValue')).toEqual([[true]]);
  });
});
