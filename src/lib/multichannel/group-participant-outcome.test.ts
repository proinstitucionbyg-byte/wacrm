import {expect,it} from 'vitest';
import {groupParticipantOutcome} from './group-participant-outcome';
it('distinguishes new additions from existing members',()=>{expect(groupParticipantOutcome(200)).toEqual({label:'Agregado',confirmed:true});expect(groupParticipantOutcome(409)).toEqual({label:'Ya estaba en el grupo',confirmed:true});});
it('never reports private invitations, unknown or missing results as additions',()=>{for(const code of [403,404,408,417,419,500,null])expect(groupParticipantOutcome(code).confirmed).toBe(false);expect(groupParticipantOutcome(403).label).toContain('invitación privada');});
