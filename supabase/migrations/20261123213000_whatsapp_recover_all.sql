alter table public.whatsapp_management_commands
  drop constraint whatsapp_management_commands_operation_check;

alter table public.whatsapp_management_commands
  add constraint whatsapp_management_commands_operation_check
  check(operation in ('create','connect','stop','unlink','recover','recover_all','replace','group_list','group_details','group_mutate'));
