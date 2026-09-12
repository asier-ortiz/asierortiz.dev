const COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

function addCopyButtonsToCodeBlocks() {
  const codeBlocks = document.querySelectorAll('pre');

  if (!codeBlocks.length) {
    return;
  }

  codeBlocks.forEach((pre) => {
    const wrapper = document.createElement('div');
    wrapper.classList.add('relative', 'group');

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const button = document.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('aria-label', 'Copy code to clipboard');
    button.className = 'copy-code-button';
    button.innerHTML = COPY_ICON;
    wrapper.appendChild(button);

    const tooltip = document.createElement('div');
    tooltip.className = 'copy-tooltip copy-tooltip-hidden';
    tooltip.innerText = 'Copied!';
    wrapper.appendChild(tooltip);

    button.addEventListener('click', async () => {
      try {
        const codeElement = pre.querySelector('code');
        const textToCopy = codeElement ? codeElement.innerText : pre.innerText;
        await navigator.clipboard.writeText(textToCopy);

        button.innerHTML = CHECK_ICON;
        tooltip.classList.remove('copy-tooltip-hidden');
        tooltip.classList.add('copy-tooltip-visible');

        setTimeout(() => {
          button.innerHTML = COPY_ICON;
          tooltip.classList.remove('copy-tooltip-visible');
          tooltip.classList.add('copy-tooltip-hidden');
        }, 2000);
      } catch (err) {
        console.error('Failed to copy code:', err);
      }
    });

    wrapper.addEventListener('mouseleave', () => {
      tooltip.classList.remove('copy-tooltip-visible');
      tooltip.classList.add('copy-tooltip-hidden');
      button.innerHTML = COPY_ICON;
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addCopyButtonsToCodeBlocks);
} else {
  addCopyButtonsToCodeBlocks();
}
