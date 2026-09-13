package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import in.zygertechnology.zygererp.config.AuditEntityListener;
import java.time.Instant;

@Entity @Table(name = "company_info")
@EntityListeners(AuditEntityListener.class)
@JsonIgnoreProperties(ignoreUnknown = true)
@Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
public class CompanyInfo {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) Long id;
    @Column(name = "company_name", nullable = false, length = 200) String companyName;
    @Column(name = "address_line1", length = 500) String addressLine1;
    @Column(name = "address_line2", length = 500) String addressLine2;
    @Column(name = "registered_address", columnDefinition = "TEXT") String registeredAddress;
    @Column(name = "delivery_address", columnDefinition = "TEXT") String deliveryAddress;
    @Column(name = "print_name", length = 200) String printName;
    @Column(name = "display_type", length = 60) String displayType;
    @Column(length = 100) String city;
    @Column(length = 100) String state;
    @Column(length = 20) String pincode;
    @Column(length = 100) @Builder.Default String country = "India" ;
    @Column(length = 30) String phone;
    @Column(length = 30) String mobile;
    @Column(length = 120) String email;
    @Column(length = 200) String website;
    @Column(name = "contact_person", length = 100) String contactPerson;
    @Column(name = "pin_no", length = 50) String pinNo;
    @Column(name = "msme_no", length = 50) String msmeNo;
    @Column(name = "tan_no", length = 50) String tanNo;
    @Column(name = "latitude", length = 50) String latitude;
    @Column(name = "longitude", length = 50) String longitude;
    @Column(name = "gst_number", length = 30) String gstNumber;
    @Column(name = "pan_number", length = 30) String panNumber;
    @Column(name = "cin_number", length = 50) String cinNumber;
    @Column(name = "gstin", length = 30) String gstin;
    @Column(name = "pan", length = 30) String pan;
    @Column(name = "cin", length = 50) String cin;
    @Column(name = "pf_no", length = 50) String pfNo;
    @Column(name = "esi_no", length = 50) String esiNo;
    @Column(name = "iec_code", length = 50) String iecCode;
    @Column(name = "gst_state", length = 60) String gstState;
    @Column(name = "gst_state_code", length = 2) String gstStateCode;
    @Column(name = "logo_path", length = 500) String logoPath;
    @Column(name = "company_logo_url", length = 500) String companyLogoUrl;
    @Column(name = "iso_logo_url", length = 500) String isoLogoUrl;
    @Column(name = "bis_logo_url", length = 500) String bisLogoUrl;
    @Column(name = "bank_name", length = 200) String bankName;
    @Column(name = "bank_account", length = 50) String bankAccount;
    @Column(name = "bank_ifsc", length = 30) String bankIfsc;
    @Column(name = "bank_branch", length = 200) String bankBranch;
    @Column(name = "bank_account_holder", length = 200) String bankAccountHolder;
    String createdBy;
    Instant createdAt;
    String updatedBy;
    Instant updatedAt;
    @Version Long version;
}
