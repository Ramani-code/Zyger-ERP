package in.zygertechnology.zygererp.repo;

import in.zygertechnology.zygererp.entity.ProductionPolicy;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface ProductionPolicyRepository extends JpaRepository<ProductionPolicy, Long> {
    Optional<ProductionPolicy> findFirstByActiveTrue();
}
