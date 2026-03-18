export interface ClientInfo {
  name: string;
  company: string;
  address: string;
  gst: string;
  phone: string;
  email: string;
}

export interface ClientState {
  clientInfo: ClientInfo | null;
}
