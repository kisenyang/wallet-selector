import ISenderWallet from "../../interfaces/ISenderWallet";
import InjectedWallet from "../types/InjectedWallet";
import { updateState } from "../../state/State";
import { AccountInfo, CallParams } from "../../interfaces/IWallet";
import InjectedSenderWallet, {
  GetRpcResponse,
  RpcChangedResponse,
} from "../../interfaces/InjectedSenderWallet";
import ProviderService from "../../services/provider/ProviderService";
import { Options } from "../../core/NearWalletSelector";
import { logger } from "../../services/logging.service";

declare global {
  interface Window {
    wallet: InjectedSenderWallet | undefined;
  }
}

class SenderWallet extends InjectedWallet implements ISenderWallet {
  wallet: InjectedSenderWallet;

  constructor(provider: ProviderService, options: Options) {
    super(provider, options);
  }

  async init() {
    await this.timeout(200);

    if (!this.isInstalled()) {
      throw new Error("Wallet not installed");
    }

    this.wallet = window.wallet!;

    this.onAccountChanged();

    this.wallet.onRpcChanged((response) => {
      this.networkMatches(response);
    });

    return this.wallet
      .init({ contractId: this.options.contractId })
      .then((res) => logger.log("SenderWallet:init", res));
  }

  getInfo() {
    return {
      id: "senderwallet",
      name: "Sender Wallet",
      description: "Sender Wallet",
      iconUrl: "https://senderwallet.io/logo.png",
    };
  }

  isInstalled() {
    return !!window.wallet;
  }

  async signIn() {
    if (!this.isInstalled()) {
      return updateState((prevState) => ({
        ...prevState,
        showWalletOptions: false,
        showSenderWalletNotInstalled: true,
      }));
    }

    if (!this.wallet) {
      await this.init();
    }

    const rpcResponse = await this.wallet.getRpc();

    if (!this.networkMatches(rpcResponse)) {
      return;
    }

    const { accessKey } = await this.wallet.requestSignIn({
      contractId: this.options.contractId,
    });

    if (!accessKey) {
      throw new Error("Failed to sign in");
    }
  }

  async timeout(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  networkMatches(response: RpcChangedResponse | GetRpcResponse) {
    if (this.options.networkId !== response.rpc.networkId) {
      updateState((prevState) => ({
        ...prevState,
        showModal: true,
        showWalletOptions: false,
        showSwitchNetwork: true,
      }));
      return false;
    }
    return true;
  }

  onAccountChanged() {
    this.wallet.onAccountChanged(async (newAccountId) => {
      logger.log("SenderWallet:onAccountChange", newAccountId);
      try {
        await this.disconnect();

        await this.signIn();
      } catch (e) {
        logger.log(`Failed to change account ${e.message}`);
      }
    });
  }

  async isConnected() {
    return this.wallet.isSignedIn();
  }

  async disconnect() {
    const res = await this.wallet.signOut();

    if (res.result !== "success") {
      throw new Error("Failed to sign out");
    }
  }

  async getAccount(): Promise<AccountInfo | null> {
    const connected = await this.isConnected();

    if (!connected) {
      return null;
    }

    const accountId = this.wallet.getAccountId();
    const account = await this.provider.viewAccount({ accountId });

    return {
      accountId,
      balance: account.amount,
    };
  }

  async call({ receiverId, actions }: CallParams) {
    logger.log("SenderWallet:call", { receiverId, actions });

    return this.wallet
      .signAndSendTransaction({ receiverId, actions })
      .then((res) => {
        if (res.error) {
          throw new Error(res.error);
        }

        return res;
      });
  }
}

export default SenderWallet;
