import {expect,it} from 'vitest';
import {activeWorkspacePath} from './workspace-navigation';
const paths=['/dashboard','/inbox','/automations','/automations/media','/settings','/flows'];
it('highlights the file library instead of two menu entries',()=>{expect(activeWorkspacePath('/automations/media',paths)).toBe('/automations/media');});
it('keeps the parent selected for its editor',()=>{expect(activeWorkspacePath('/automations/123/edit',paths)).toBe('/automations');expect(activeWorkspacePath('/flows/123',paths)).toBe('/flows');});
it('does not confuse similarly named routes',()=>{expect(activeWorkspacePath('/inbox-other',paths)).toBeNull();expect(activeWorkspacePath('/settings/team',paths)).toBe('/settings');});
it('never changes the menu order',()=>{const original=[...paths];activeWorkspacePath('/automations/media',paths);expect(paths).toEqual(original);});
