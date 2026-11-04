// The provider may invoke LocalAuth.logout from an async frame listener.
// Its recursive rm can throw EBUSY on Windows and kill every line in the hub.
// Actual Client.logout still logs out on WhatsApp and closes that browser;
// keep its local files, just as we keep the independent history archive.
export function retainingLocalAuth(BaseAuth){
 return class RetainingLocalAuth extends BaseAuth{
  async logout(){/* Profile retained. A revoked session still needs the phone's QR. */}
 };
}
