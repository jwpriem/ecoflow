import AuthenticationServices
import Capacitor

/// Signs in on another site (SolarEdge) in Apple's sign-in sheet. The sheet closes when the server sends it to
/// `scheme://…` (shared/appReturn.ts) and that URL goes back to the app. An ephemeral session: no cookies shared
/// with Safari, so no "wants to use … to sign in" prompt.
@objc(WebAuthPlugin)
public class WebAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "WebAuthPlugin"
    public let jsName = "WebAuth"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)]
    private var session: ASWebAuthenticationSession?

    @objc func start(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https", let scheme = call.getString("scheme") else {
            call.reject("An https url and a scheme are required")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
                self?.session = nil
                if let callback = callback {
                    call.resolve(["url": callback.absoluteString])
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.resolve([:])
                } else {
                    call.reject(error?.localizedDescription ?? "Sign-in failed")
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Sign-in could not start")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}

/// The app's web view, with the plugins that live in this project rather than in a package
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WebAuthPlugin())
    }
}
