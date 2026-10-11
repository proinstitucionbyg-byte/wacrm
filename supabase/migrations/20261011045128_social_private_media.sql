-- Private objects only. Browser clients have no direct SELECT/INSERT policy;
-- the message proxy enforces conversation visibility with the user's RLS.
INSERT INTO storage.buckets(id,name,public,file_size_limit)
VALUES('social-media','social-media',false,10485760)
ON CONFLICT(id) DO NOTHING;
